import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  NotEquals,
} from 'class-validator';

export class AdjustStockDto {
  @IsUUID()
  variantId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsNumber()
  @NotEquals(0)
  quantityDelta!: number;

  @IsString()
  reason!: string;
}
