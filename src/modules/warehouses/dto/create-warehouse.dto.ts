import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be uppercase snake_case (A-Z, 0-9, _)',
  })
  code!: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
