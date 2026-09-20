import { Prisma } from "@prisma/client";

/**
 * Write an audit log entry within a transaction.
 *
 * This function MUST be called only from inside the same transaction as the
 * mutation it records. This ensures atomicity: the audit entry and the change
 * it describes can never fall out of sync under a race or a partial failure.
 *
 * It does not accept the global prisma singleton; it takes a transaction client
 * explicitly to enforce this constraint.
 *
 * @param tx - Prisma transaction client (not the global singleton)
 * @param input - Audit log data: actor, entity type/id, action, and optional before/after snapshots
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.before ? JSON.parse(JSON.stringify(input.before)) : null,
      afterJson: input.after ? JSON.parse(JSON.stringify(input.after)) : null,
    },
  });
}
