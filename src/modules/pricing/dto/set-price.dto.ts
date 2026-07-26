import { IsNumber, IsPositive, IsString } from 'class-validator';

export class SetPriceDto {
  @IsString()
  priceListKey!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
