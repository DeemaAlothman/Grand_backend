import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { MEDIA_ENTITY_TYPES } from '../media.constants';

export class ConfirmMediaDto {
  @IsString()
  key!: string;

  @IsIn(MEDIA_ENTITY_TYPES)
  entityType!: (typeof MEDIA_ENTITY_TYPES)[number];

  @IsUUID()
  entityId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
