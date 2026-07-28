import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PaymentsService } from './payments.service';
import { PayOrderDto } from './dto/pay-order.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('orders/:orderId/pay')
  pay(
    @Param('orderId') orderId: string,
    @Body() dto: PayOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.pay(orderId, dto, user, idempotencyKey);
  }

  @RequirePermissions('orders.refund')
  @Post('payments/:paymentId/refund')
  refund(
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.refund(paymentId, dto, user.id);
  }
}
