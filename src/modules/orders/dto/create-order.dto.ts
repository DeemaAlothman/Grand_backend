import { IsObject, IsOptional } from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, unknown>;
}
