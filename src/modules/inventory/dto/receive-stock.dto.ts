import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class ReceiveStockDto {
  @IsUUID()
  variantId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
