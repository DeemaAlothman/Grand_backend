import { IsOptional, IsString } from 'class-validator';

export class CreateShipmentDto {
  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;
}
