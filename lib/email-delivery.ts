/**
 * The audit-log queries behind G16's delivery badges. The RULE they apply lives in
 * `email-delivery-verdicts.ts` and is unit-tested there; this file is the database half.
 *
 * Read from `AuditLog` rather than from a column on each table, deliberately: the verdict is an
 * event about an attempt, not a property of the row, and a mail re-sent by hand does not un-happen.
 * It also means no migration and no second source of truth for "did it go out".
 *
 * Note on cost: both queries are `action = ? AND entityId IN (…)` against a table indexed only on
 * `createdAt`, i.e. a sequential scan. On an admin-only page over a narrow table that is single-digit
 * milliseconds and stays that way well past 10k rows. If `AuditLog` ever passes ~100k, add
 * `@@index([action, entityId])` — a migration is real overhead here (hand-written SQL plus a box
 * apply step), so it is not worth taking before the scan is measurable.
 */
import { db } from "@/lib/db";
import { failedIds, notFlaggedIds } from "@/lib/email-delivery-verdicts";

/** Ids whose mail is recorded as having failed, for a `*.failed`-style action. */
export async function failedByAction(action: string, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  return failedIds(
    await db.auditLog.findMany({
      where: { action, entityId: { in: entityIds } },
      select: { entityId: true },
    }),
  );
}

/** Ids whose mail is recorded as NOT delivered, for an action carrying a boolean flag in its meta. */
export async function notFlaggedByAction(
  action: string,
  entityIds: string[],
  flag = "emailed",
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  return notFlaggedIds(
    await db.auditLog.findMany({
      where: { action, entityId: { in: entityIds } },
      select: { entityId: true, meta: true },
    }),
    flag,
  );
}
