import { AttributeType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAttributeDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'key must be lowercase snake_case (a-z, 0-9, _)',
  })
  key!: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsEnum(AttributeType)
  type!: AttributeType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;
}
