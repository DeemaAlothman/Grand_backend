import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class LinkCategoryAttributeDto {
  @IsUUID()
  categoryId!: string;

  @IsUUID()
  attributeId!: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  @IsBoolean()
  createsVariant?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
