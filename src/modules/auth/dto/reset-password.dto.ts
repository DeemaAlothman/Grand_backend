import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsNotCommonPassword } from '../../../common/validators/not-common-password.validator';

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @IsNotCommonPassword()
  newPassword!: string;
}
