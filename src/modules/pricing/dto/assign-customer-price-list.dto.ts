import { IsOptional, IsString } from 'class-validator';

export class AssignCustomerPriceListDto {
  /** A price list key (e.g. "wholesale"), or omit/null to reset the customer back to retail pricing. */
  @IsOptional()
  @IsString()
  priceListKey?: string | null;
}
