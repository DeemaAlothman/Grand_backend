import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  variantId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}
