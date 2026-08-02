import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      secure: false,
    });
  }

  async sendPasswordResetEmail(to: string, resetToken: string) {
    await this.transporter.sendMail({
      from: 'no-reply@printing-store.local',
      to,
      subject: 'إعادة تعيين كلمة المرور',
      text: `رمز إعادة تعيين كلمة المرور الخاص بك: ${resetToken}\nصالح لمدة 30 دقيقة، ويُستخدم مرة واحدة فقط.`,
    });
    this.logger.log(`Password reset email queued for ${to}`);
  }

  async send(to: string, subject: string, text: string) {
    await this.transporter.sendMail({
      from: 'no-reply@printing-store.local',
      to,
      subject,
      text,
    });
    this.logger.log(`Email "${subject}" queued for ${to}`);
  }
}
