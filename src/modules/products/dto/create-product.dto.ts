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
import { ProductType, SellingUnit } from '@prisma/client';
import { AttributeValueInputDto } from './attribute-value-input.dto';

export class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ProductType)
  type!: ProductType;

  @IsEnum(SellingUnit)
  sellingUnit!: SellingUnit;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  minOrderQuantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueInputDto)
  attributeValues?: AttributeValueInputDto[];

  // Only used when type = SIMPLE, to create the product's single implicit variant.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  weight?: number;
}
