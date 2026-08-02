import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SetPriceDto } from './dto/set-price.dto';
import { BulkUpdatePricesDto } from './dto/bulk-update-prices.dto';

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async setPrice(variantId: string, dto: SetPriceDto, actorId: string) {
    const [variant, priceList] = await Promise.all([
      this.prisma.productVariant.findUnique({ where: { id: variantId } }),
      this.prisma.priceList.findUnique({ where: { key: dto.priceListKey } }),
    ]);
    if (!variant) throw new NotFoundException('variant not found');
    if (!priceList)
      throw new NotFoundException(`price list "${dto.priceListKey}" not found`);

    const before = await this.prisma.price.findUnique({
      where: {
        variantId_priceListId: { variantId, priceListId: priceList.id },
      },
    });

    const price = await this.prisma.price.upsert({
      where: {
        variantId_priceListId: { variantId, priceListId: priceList.id },
      },
      update: { amount: dto.amount },
      create: { variantId, priceListId: priceList.id, amount: dto.amount },
      include: { priceList: true },
    });

    await this.auditService.log({
      actorId,
      action: 'price.set',
      entityType: 'price',
      entityId: price.id,
      before,
      after: price,
    });

    return price;
  }

  /** The price list a given customer sees: their assigned override (e.g. wholesale), or "retail" by default. */
  async resolvePriceListForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { priceList: true },
    });
    if (user?.priceList) {
      return user.priceList;
    }
    return this.prisma.priceList.findUniqueOrThrow({
      where: { key: 'retail' },
    });
  }

  /** Assigns (or clears, with `priceListKey: null`) a special price list for one customer. */
  async assignCustomerPriceList(
    customerId: string,
    priceListKey: string | null,
    actorId: string,
  ) {
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('customer not found');
    }

    let priceListId: string | null = null;
    if (priceListKey) {
      const priceList = await this.prisma.priceList.findUnique({
        where: { key: priceListKey },
      });
      if (!priceList) {
        throw new NotFoundException(`price list "${priceListKey}" not found`);
      }
      priceListId = priceList.id;
    }

    const updated = await this.prisma.user.update({
      where: { id: customerId },
      data: { priceListId },
      include: { priceList: true },
    });

    await this.auditService.log({
      actorId,
      action: 'user.price_list_assigned',
      entityType: 'user',
      entityId: customerId,
      after: { priceListKey: updated.priceList?.key ?? null },
    });

    return {
      id: updated.id,
      email: updated.email,
      priceList: updated.priceList,
    };
  }

  async bulkUpdate(dto: BulkUpdatePricesDto, actorId: string) {
    if (dto.updates.length === 0) {
      throw new BadRequestException('updates cannot be empty');
    }

    const priceListKeys = [
      ...new Set(dto.updates.map((entry) => entry.priceListKey)),
    ];
    const priceLists = await this.prisma.priceList.findMany({
      where: { key: { in: priceListKeys } },
    });
    const priceListByKey = new Map(priceLists.map((list) => [list.key, list]));

    const missingKey = priceListKeys.find((key) => !priceListByKey.has(key));
    if (missingKey) {
      throw new NotFoundException(`price list "${missingKey}" not found`);
    }

    const variantIds = [
      ...new Set(dto.updates.map((entry) => entry.variantId)),
    ];
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
    });
    if (variants.length !== variantIds.length) {
      throw new NotFoundException('one or more variants were not found');
    }

    const results = await this.prisma.$transaction(
      dto.updates.map((entry) => {
        const priceList = priceListByKey.get(entry.priceListKey)!;
        return this.prisma.price.upsert({
          where: {
            variantId_priceListId: {
              variantId: entry.variantId,
              priceListId: priceList.id,
            },
          },
          update: { amount: entry.amount },
          create: {
            variantId: entry.variantId,
            priceListId: priceList.id,
            amount: entry.amount,
          },
        });
      }),
    );

    await this.auditService.log({
      actorId,
      action: 'price.bulk_update',
      entityType: 'price',
      after: { count: results.length },
    });

    return { updated: results.length };
  }
}
