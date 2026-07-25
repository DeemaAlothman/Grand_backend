import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateAttributeOptionDto {
  @IsString()
  value!: string;

  @IsString()
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
