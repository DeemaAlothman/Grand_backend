import { IsIn } from 'class-validator';
import { ROLE_DEFINITIONS } from '../../../common/constants/permissions.constants';

const ASSIGNABLE_ROLE_KEYS = Object.keys(ROLE_DEFINITIONS);

export class UpdateUserRoleDto {
  @IsIn(ASSIGNABLE_ROLE_KEYS)
  roleKey!: string;
}
