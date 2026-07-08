import { db } from "@/lib/db";
import { retentionCutoffs, type RetentionConfig } from "@/lib/retention-policy";

// The DB half of the storage-limitation sweep (pure policy is in retention-policy.ts).
// Billing (NL 7-yr bookkeeping floor) is deliberately deferred — nothing qualifies
// for years and it needs FK-cascade design + is the most legally sensitive.

export interface RetentionResult {
  inviteTokens: number;
  auditLogs: number;
  rejectedApplications: number;
}

/**
 * Runs the sweep. No-ops (returns zeros, touches no rows) unless enabled — a
 * defense-in-depth guard on top of the route's own check. Deletes:
 *  - InviteTokens that are DONE (used or expired) and older than the window.
 *  - AuditLogs older than the window.
 *  - REJECTED PartnerApplications older than the window (dead-end records with
 *    applicant PII and no FK dependents → safe to delete outright).
 */
export async function runRetention(now: Date, config: RetentionConfig): Promise<RetentionResult> {
  if (!config.enabled) {
    return { inviteTokens: 0, auditLogs: 0, rejectedApplications: 0 };
  }
  const cut = retentionCutoffs(now, config);

  const inviteTokens = await db.inviteToken.deleteMany({
    where: {
      createdAt: { lt: cut.inviteTokenBefore },
      OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }],
    },
  });
  const auditLogs = await db.auditLog.deleteMany({
    where: { createdAt: { lt: cut.auditLogBefore } },
  });
  const rejectedApplications = await db.partnerApplication.deleteMany({
    where: { status: "REJECTED", createdAt: { lt: cut.rejectedApplicationBefore } },
  });

  return {
    inviteTokens: inviteTokens.count,
    auditLogs: auditLogs.count,
    rejectedApplications: rejectedApplications.count,
  };
}
