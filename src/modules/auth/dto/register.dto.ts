import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsNotCommonPassword } from '../../../common/validators/not-common-password.validator';

export class RegisterDto {
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
}
