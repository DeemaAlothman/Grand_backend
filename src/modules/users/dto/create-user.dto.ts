import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsNotCommonPassword } from '../../../common/validators/not-common-password.validator';
import { ROLE_DEFINITIONS } from '../../../common/constants/permissions.constants';

const ASSIGNABLE_ROLE_KEYS = Object.keys(ROLE_DEFINITIONS);

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @IsNotCommonPassword()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsIn(ASSIGNABLE_ROLE_KEYS)
  roleKey!: string;
}
