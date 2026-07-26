import { Prisma } from '@prisma/client';

/**
 * Prisma's P2002 `meta.target` isn't always populated as an array of column names
 * (observed gaps when using driver adapters like @prisma/adapter-pg), so this also
 * falls back to scanning the raw error message, which always names the constraint.
 */
export function violatesUniqueConstraint(
  error: unknown,
  needle: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  const targetText = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : '';
  return (
    targetText.toLowerCase().includes(needle.toLowerCase()) ||
    error.message.toLowerCase().includes(needle.toLowerCase())
  );
}

export function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
