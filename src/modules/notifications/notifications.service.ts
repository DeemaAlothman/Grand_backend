import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MailService } from '../../infrastructure/mail/mail.service';

/**
 * Thin wrapper over MailService with the actual order-lifecycle templates. A failed
 * notification must never break the underlying business transaction (order/payment/shipment
 * already committed by the time we notify) - every send here is best-effort and logged, not thrown.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
  ) {}

  private async emailFor(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  private async safeSend(to: string | null, subject: string, text: string) {
    if (!to) return;
    await this.mailService.send(to, subject, text).catch((error: Error) => {
      this.logger.warn(
        `Failed to send "${subject}" to ${to}: ${error.message}`,
      );
    });
  }

  async orderCreated(userId: string, orderNumber: string, total: number) {
    const to = await this.emailFor(userId);
    await this.safeSend(
      to,
      `تأكيد الطلب ${orderNumber}`,
      `شكرًا لطلبك! رقم الطلب: ${orderNumber}\nالمبلغ الإجمالي: ${total}\nالحالة: بانتظار الدفع.`,
    );
  }

  async paymentReceived(userId: string, orderNumber: string, amount: number) {
    const to = await this.emailFor(userId);
    await this.safeSend(
      to,
      `تم استلام الدفع - طلب ${orderNumber}`,
      `تم استلام دفعتك بمبلغ ${amount} للطلب رقم ${orderNumber} بنجاح.`,
    );
  }

  async orderShipped(
    userId: string,
    orderNumber: string,
    trackingNumber: string | null,
  ) {
    const to = await this.emailFor(userId);
    await this.safeSend(
      to,
      `تم شحن طلبك ${orderNumber}`,
      `طلبك رقم ${orderNumber} بالطريق إليك الآن.${trackingNumber ? `\nرقم التتبع: ${trackingNumber}` : ''}`,
    );
  }

  async orderDelivered(userId: string, orderNumber: string) {
    const to = await this.emailFor(userId);
    await this.safeSend(
      to,
      `تم تسليم طلبك ${orderNumber}`,
      `طلبك رقم ${orderNumber} تم تسليمه. نتمنى لك تجربة جيدة!`,
    );
  }
}
