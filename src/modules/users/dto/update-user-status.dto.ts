import { IsIn } from 'class-validator';

// PENDING_VERIFICATION excluded on purpose: it's an internal state for self-registered,
// not-yet-verified accounts — an admin can activate, suspend, or disable, not reset to "pending".
const ADMIN_SETTABLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;

export class UpdateUserStatusDto {
  @IsIn(ADMIN_SETTABLE_STATUSES)
  status!: (typeof ADMIN_SETTABLE_STATUSES)[number];
}
