import { db } from "@/lib/db";

/**
 * Which of a set of records had a mail FAIL, according to the audit log.
 *
 * G16 (EMAIL-SPEC-CONTROL-PLANE §5): `sendEmail` reports a failed send as
 * `{sent:false}` rather than throwing, so a mail that never left is invisible unless something
 * shows it. G5 made the signup failure durable; this is what puts it — and the invoice, invite and
 * reset verdicts — on a screen a founder actually looks at.
 *
 * Read from `AuditLog` rather than from a column on each table, deliberately: the verdict is an
 * event about an attempt, not a property of the row, and a mail that is re-sent by hand does not
 * un-happen. It also means no migration and no second source of truth for "did it go out".
 *
 * Two shapes are supported, because the two writers evolved separately and both are already in
 * production data:
 *   - a dedicated failure action (`signup.welcome.failed`), written only when the send failed;
 *   - a success/failure flag on an action that is written either way (`billing.invoice.issued`
 *     carries `meta.emailed`).
 * A record with no row at all is "nothing recorded" — NOT "delivered". The distinction matters:
 * every row created before this shipped is in that state, and a screen that called them delivered
 * would be lying about the exact thing it exists to report.
 */
export type DeliveryVerdict = "failed" | "unknown";

/** Ids whose mail is recorded as having failed, for a `*.failed`-style action. */
export async function failedByAction(action: string, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  const rows = await db.auditLog.findMany({
    where: { action, entityId: { in: entityIds } },
    select: { entityId: true },
  });

  return new Set(rows.map((r) => r.entityId).filter((id): id is string => id !== null));
}

/**
 * Ids whose mail is recorded as NOT delivered, for an action that carries `meta.emailed`.
 * `emailed: true` and a missing flag are both "not a recorded failure" — the flag was added after
 * the action existed, so an older row genuinely does not know.
 */
export async function notEmailedByFlag(action: string, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  const rows = await db.auditLog.findMany({
    where: { action, entityId: { in: entityIds } },
    select: { entityId: true, meta: true },
  });

  const failed = new Set<string>();

  for (const row of rows) {
    if (row.entityId === null) continue;

    const meta = row.meta as { emailed?: unknown } | null;
    if (meta && meta.emailed === false) failed.add(row.entityId);
  }

  return failed;
}
