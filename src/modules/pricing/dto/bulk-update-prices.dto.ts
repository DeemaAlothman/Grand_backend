import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class BulkPriceEntryDto {
  @IsUUID()
  variantId!: string;

  @IsString()
  priceListKey!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class BulkUpdatePricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkPriceEntryDto)
  updates!: BulkPriceEntryDto[];
}
