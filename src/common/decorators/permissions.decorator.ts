import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../constants/permissions.constants';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
