import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
