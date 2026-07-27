import {
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MEDIA_ENTITY_TYPES } from '../media.constants';

export class PresignMediaDto {
  @IsIn(MEDIA_ENTITY_TYPES)
  entityType!: (typeof MEDIA_ENTITY_TYPES)[number];

  @IsUUID()
  entityId!: string;

  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @IsPositive()
  size!: number;
}
