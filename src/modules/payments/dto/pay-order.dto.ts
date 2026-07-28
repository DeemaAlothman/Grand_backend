import { IsBoolean, IsOptional } from 'class-validator';

export class PayOrderDto {
  /** Mock provider only: forces a failed payment, for testing the PAYMENT_FAILED path. */
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
