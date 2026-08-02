import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CartService } from '../cart/cart.service';
import { InventoryService } from '../inventory/inventory.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { PricingService } from '../pricing/pricing.service';
import { CouponsService } from '../promotions/coupons.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  STOCK_RELEASE_JOB,
  STOCK_RELEASE_QUEUE,
  getPaymentTimeoutMs,
} from '../../jobs/stock-release/stock-release.constants';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { canTransition, stockPhaseFor } from './order-status.rules';

const ORDER_INCLUDE = {
  items: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  payments: true,
  shipments: true,
};

const ORDER_STATUSES: OrderStatus[] = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'RETURN_REQUESTED',
  'RETURNED',
  'REFUNDED',
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly cartService: CartService,
    private readonly inventoryService: InventoryService,
    private readonly warehousesService: WarehousesService,
    private readonly pricingService: PricingService,
    private readonly couponsService: CouponsService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(STOCK_RELEASE_QUEUE) private readonly stockReleaseQueue: Queue,
  ) {}

  async createFromCart(
    userId: string,
    dto: CreateOrderDto,
    idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey },
        include: ORDER_INCLUDE,
      });
      if (existing) {
        return existing;
      }
    }

    const cart = await this.cartService.getCart(userId);
    if (cart.items.length === 0) {
      throw new BadRequestException('cart is empty');
    }
    if (cart.total === null) {
      throw new ConflictException(
        'one or more items in your cart have no price set; remove them and try again',
      );
    }

    const warehouse = await this.warehousesService.findDefault();
    const priceList = await this.pricingService.resolvePriceListForUser(userId);
    const orderNumber = generateOrderNumber();

    // Validated up front (outside the transaction) so a bad coupon fails fast with a clear
    // message; it's still redeemed atomically inside the transaction below to close the
    // race window against the usage limit.
    const couponResult = dto.couponCode
      ? await this.couponsService.validate(dto.couponCode, cart.total)
      : null;
    const discountAmount = couponResult?.discountAmount ?? 0;
    const total = Math.round((cart.total - discountAmount) * 100) / 100;

    const order = await this.prisma.$transaction(async (tx) => {
      if (couponResult) {
        const redeemed = await this.couponsService.redeem(
          tx,
          couponResult.coupon.id,
        );
        if (!redeemed) {
          throw new ConflictException(
            'this coupon just reached its usage limit; please remove it and try again',
          );
        }
      }

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId,
          status: 'PENDING_PAYMENT',
          subtotal: cart.total!,
          discountAmount,
          shippingFee: 0,
          total,
          couponId: couponResult?.coupon.id,
          couponCode: couponResult?.coupon.code,
          idempotencyKey,
          shippingAddress: dto.shippingAddress as
            Prisma.InputJsonValue | undefined,
        },
      });

      for (const item of cart.items) {
        const price = item.variant.prices.find(
          (p) => p.priceListId === priceList.id,
        )!;
        const quantity = Number(item.quantity);

        const reserved = await this.inventoryService.reserve(
          tx,
          item.variantId,
          warehouse.id,
          quantity,
          created.id,
          userId,
        );
        if (!reserved) {
          throw new ConflictException(
            `insufficient stock for SKU "${item.variant.sku}" (requested ${quantity})`,
          );
        }

        await tx.orderItem.create({
          data: {
            orderId: created.id,
            variantId: item.variantId,
            productNameSnapshot: item.variant.product.name,
            skuSnapshot: item.variant.sku,
            attributesSnapshot: item.variant.attributeValues.map((av) => ({
              key: av.attribute.key,
              value: av.value,
            })),
            unitPriceSnapshot: price.amount,
            quantity,
            lineTotal: Number(price.amount) * quantity,
          },
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: 'PENDING_PAYMENT',
          actorId: userId,
        },
      });

      const userCart = await tx.cart.findUniqueOrThrow({ where: { userId } });
      await tx.cartItem.deleteMany({ where: { cartId: userCart.id } });

      return created;
    });

    await this.auditService.log({
      actorId: userId,
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      after: order,
    });

    await this.stockReleaseQueue.add(
      STOCK_RELEASE_JOB,
      { orderId: order.id },
      { jobId: order.id, delay: getPaymentTimeoutMs() },
    );

    await this.notificationsService.orderCreated(
      userId,
      order.orderNumber,
      Number(order.total),
    );

    return this.findOne(order.id);
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('order not found');
    }
    return order;
  }

  /** A customer may view their own order even without `orders.read`; anyone with `orders.read` may view any order. */
  async findOneForUser(
    id: string,
    user: { id: string; permissions: string[] },
  ) {
    const order = await this.findOne(id);
    if (order.userId !== user.id && !user.permissions.includes('orders.read')) {
      throw new NotFoundException('order not found');
    }
    return order;
  }

  findMine(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(query: Record<string, string>) {
    const status = query.status as OrderStatus | undefined;
    if (status !== undefined && !ORDER_STATUSES.includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${ORDER_STATUSES.join(', ')}`,
      );
    }
    const limitRaw = query.limit !== undefined ? Number(query.limit) : 20;
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
      throw new BadRequestException(
        'limit must be an integer between 1 and 100',
      );
    }
    if (query.cursor !== undefined && !UUID_RE.test(query.cursor)) {
      throw new BadRequestException('cursor must be a valid UUID');
    }

    const orders = await this.prisma.order.findMany({
      where: status ? { status } : undefined,
      include: ORDER_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limitRaw + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = orders.length > limitRaw;
    const page = orders.slice(0, limitRaw);

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
    };
  }

  /**
   * Called only from the HTTP controller (internal callers — payments/shipments/stock-release —
   * go straight to `updateStatus` and are already trusted). Staff with `orders.updateStatus` may
   * request any transition; an order's own customer may only request `CANCELLED`, i.e.
   * self-service cancellation. Non-owners without the permission get 404, matching
   * `findOneForUser`'s ownership-hiding behavior.
   */
  async authorizeStatusChange(
    id: string,
    targetStatus: OrderStatus,
    user: { id: string; permissions: string[] },
  ) {
    if (user.permissions.includes('orders.updateStatus')) {
      return;
    }
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!order || order.userId !== user.id) {
      throw new NotFoundException('order not found');
    }
    if (targetStatus !== 'CANCELLED') {
      throw new ForbiddenException(
        'you may only cancel your own order; other status changes require staff access',
      );
    }
  }

  /**
   * `actorId: null` means an automated/system transition (e.g. the stock-release job). It's
   * stored as a plain "system" label on order/inventory history (no FK there), but passed as
   * NULL to the audit log, since `AuditLog.actorId` is a real foreign key to `users.id` and
   * a fake string would violate that constraint.
   */
  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    actorId: string | null,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('order not found');
    }
    if (!canTransition(order.status, dto.status)) {
      throw new ConflictException(
        `cannot transition order from "${order.status}" to "${dto.status}"`,
      );
    }

    const historyActorId = actorId ?? 'system';
    const warehouse = await this.warehousesService.findDefault();
    const fromPhase = stockPhaseFor(order.status);
    const toPhase = stockPhaseFor(dto.status);

    await this.prisma.$transaction(async (tx) => {
      if (fromPhase === 'RESERVED' && toPhase === 'NONE') {
        for (const item of order.items) {
          await this.inventoryService.release(
            tx,
            item.variantId,
            warehouse.id,
            Number(item.quantity),
            order.id,
            historyActorId,
          );
        }
      } else if (fromPhase === 'RESERVED' && toPhase === 'DEDUCTED') {
        for (const item of order.items) {
          await this.inventoryService.deduct(
            tx,
            item.variantId,
            warehouse.id,
            Number(item.quantity),
            order.id,
            historyActorId,
          );
        }
      } else if (fromPhase === 'DEDUCTED' && toPhase === 'NONE') {
        for (const item of order.items) {
          await this.inventoryService.returnStock(
            tx,
            item.variantId,
            warehouse.id,
            Number(item.quantity),
            order.id,
            historyActorId,
          );
        }
      }

      const timestampField: Partial<Record<OrderStatus, string>> = {
        CONFIRMED: 'confirmedAt',
        PAID: 'paidAt',
        SHIPPED: 'shippedAt',
        DELIVERED: 'deliveredAt',
        CANCELLED: 'cancelledAt',
      };
      const field = timestampField[dto.status];

      await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          cancelReason: dto.status === 'CANCELLED' ? dto.reason : undefined,
          ...(field ? { [field]: new Date() } : {}),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: dto.status,
          actorId: historyActorId,
          reason: dto.reason,
        },
      });
    });

    await this.auditService.log({
      actorId,
      action: 'order.status_change',
      entityType: 'order',
      entityId: id,
      before: { status: order.status },
      after: { status: dto.status },
      reason: dto.reason,
    });

    if (
      order.status === 'PENDING_PAYMENT' &&
      dto.status !== 'PENDING_PAYMENT'
    ) {
      // Best-effort: the job is a no-op anyway if it fires late, this just avoids clutter.
      await this.stockReleaseQueue.remove(id).catch(() => undefined);
    }

    if (dto.status === 'PAID') {
      await this.notificationsService.paymentReceived(
        order.userId,
        order.orderNumber,
        Number(order.total),
      );
    } else if (dto.status === 'SHIPPED') {
      await this.notificationsService.orderShipped(
        order.userId,
        order.orderNumber,
        null,
      );
    } else if (dto.status === 'DELIVERED') {
      await this.notificationsService.orderDelivered(
        order.userId,
        order.orderNumber,
      );
    }

    return this.findOne(id);
  }
}
