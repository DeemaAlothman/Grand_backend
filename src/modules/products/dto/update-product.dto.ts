import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProductStatus, SellingUnit } from '@prisma/client';
import { AttributeValueInputDto } from './attribute-value-input.dto';

export class UpdateProductDto {
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(SellingUnit)
  sellingUnit?: SellingUnit;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  minOrderQuantity?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueInputDto)
  attributeValues?: AttributeValueInputDto[];
}
