/**
 * The RULE behind G16's delivery badges, with no database in sight.
 *
 * `sendEmail` reports a failed send as `{sent:false}` rather than throwing, so a mail that never
 * left is invisible unless something shows it. What these two functions decide is which records to
 * mark — and the load-bearing half is what they DON'T mark: **a record with no audit row is
 * "nothing recorded", never "delivered"**. Every record created before the verdict was captured is
 * in that state, and a screen that read them as delivered would be lying about the exact thing it
 * exists to report.
 *
 * Split from `email-delivery.ts` for the reason `vies-result.ts` is split from `vies.ts` (see
 * `vitest.config.ts`): the part that is easy to get wrong must be unit-measurable, and the query
 * wrapper around it must not drag a database into the unit suite.
 */

/** The shape both readers need out of an audit row. */
export type AuditVerdictRow = { entityId: string | null; meta?: unknown };

/**
 * Ids from a `*.failed`-style action — one written ONLY when the send failed, so every row present
 * is a failure and every id absent is unknown.
 */
export function failedIds(rows: readonly AuditVerdictRow[]): Set<string> {
  // The null guard is not defensive noise: `entityId` is nullable on AuditLog, and a null in the
  // set would sit there matching nothing while looking like it worked.
  return new Set(rows.map((r) => r.entityId).filter((id): id is string => id !== null));
}

/**
 * Ids from an action that is written either way and carries a boolean flag in its meta. Only an
 * explicit `false` counts: the flag was added after the action existed, so an older row genuinely
 * does not know — and a red badge on every historical invoice trains a founder to ignore the column.
 */
export function notFlaggedIds(rows: readonly AuditVerdictRow[], flag: string): Set<string> {
  const failed = new Set<string>();

  for (const row of rows) {
    if (row.entityId === null) continue;

    const meta = row.meta as Record<string, unknown> | null | undefined;
    if (meta && meta[flag] === false) failed.add(row.entityId);
  }

  return failed;
}
