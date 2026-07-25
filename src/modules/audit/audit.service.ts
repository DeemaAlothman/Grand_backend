import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry) {
    return this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before:
          entry.before === undefined ? undefined : (entry.before as object),
        after: entry.after === undefined ? undefined : (entry.after as object),
        reason: entry.reason ?? null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
