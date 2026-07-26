import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AttributeValueInputDto } from './attribute-value-input.dto';

export class CreateVariantDto {
  @IsString()
  @MaxLength(100)
  sku!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  weight?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueInputDto)
  attributeValues!: AttributeValueInputDto[];
}
