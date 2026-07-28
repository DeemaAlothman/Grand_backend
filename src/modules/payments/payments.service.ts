import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PayOrderDto } from './dto/pay-order.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ordersService: OrdersService,
  ) {}

  async pay(
    orderId: string,
    dto: PayOrderDto,
    actor: AuthenticatedUser,
    idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    const order = await this.ordersService.findOneForUser(orderId, actor);
    if (
      order.status !== 'PENDING_PAYMENT' &&
      order.status !== 'PAYMENT_FAILED'
    ) {
      throw new ConflictException(
        `order is "${order.status}" and cannot be paid`,
      );
    }

    const succeeded = !dto.simulateFailure;
    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        provider: 'mock',
        amount: order.total,
        status: succeeded ? 'SUCCEEDED' : 'FAILED',
        idempotencyKey,
        providerRef: succeeded ? `mock_${Date.now()}` : undefined,
      },
    });

    await this.ordersService.updateStatus(
      orderId,
      {
        status: succeeded ? 'PAID' : 'PAYMENT_FAILED',
        reason: succeeded ? undefined : 'mock payment declined',
      },
      actor.id,
    );

    await this.auditService.log({
      actorId: actor.id,
      action: 'payment.process',
      entityType: 'payment',
      entityId: payment.id,
      after: payment,
    });

    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  async refund(paymentId: string, dto: RefundPaymentDto, actorId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException('payment not found');
    }
    if (payment.status !== 'SUCCEEDED') {
      throw new BadRequestException('only a succeeded payment can be refunded');
    }

    const alreadyRefunded = await this.prisma.refund.aggregate({
      where: { paymentId, status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const refundedSoFar = Number(alreadyRefunded._sum.amount ?? 0);
    if (refundedSoFar + dto.amount > Number(payment.amount)) {
      throw new BadRequestException(
        'refund amount exceeds the remaining refundable balance',
      );
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId,
        amount: dto.amount,
        reason: dto.reason,
        status: 'SUCCEEDED',
      },
    });

    if (refundedSoFar + dto.amount >= Number(payment.amount)) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'REFUNDED' },
      });
    }

    await this.auditService.log({
      actorId,
      action: 'payment.refund',
      entityType: 'refund',
      entityId: refund.id,
      after: refund,
      reason: dto.reason,
    });

    return refund;
  }
}
