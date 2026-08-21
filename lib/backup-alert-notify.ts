// The scheduled half of backup alerting (ADR-014 D5). Three modules, one job:
//   backup-overview-load.ts   — reads what the page reads
//   backup-alert-policy.ts    — decides WHETHER, and what is true when it does
//   this file                 — says it, and records that it was said
//
// TWO RULES CARRY THIS FILE, and both are about staying honest when something
// else is broken:
//
// 1. AN UNREADABLE REGISTRY STOPS THE SWEEP DEAD. The page degrades instead of
//    blanking, which is right for a page. Here it would be catastrophic: with no
//    registry every tenant loses the entry that makes a nightly EXPECTED, the
//    concern list empties, and the sweep mails a cheerful all-clear at the exact
//    moment it went blind. So a registry fault sends nothing, writes no marker,
//    and is reported to the caller — the workflow fails the run on it, which is
//    the alarm for the alarm.
//
// 2. A MARKER IS ONLY WRITTEN FOR A MAIL THAT ACTUALLY LEFT. `trial-warning-
//    notify.ts` does the opposite deliberately (re-warning a PARTNER is worse
//    than one missed mail). The recipient here is the founder and the subject is
//    data loss, so the trade flips: a send that failed must be retried on the
//    next sweep, not silently marked as said.

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { founderInbox } from "@/lib/email";
import { loadBackupOverview } from "@/lib/backup-overview-load";
import {
  buildBackupAlert,
  decideBackupAlert,
  type BackupAlert,
  type BackupAlertDecision,
  type BackupAlertLevel,
  type BackupAlertMarker,
} from "@/lib/backup-alert-policy";
import { sendBackupAlertEmail, sendBackupClearedEmail } from "@/lib/backup-alert-email";

/** One audit action per kind, so "what was last said?" is an indexed query on a
 *  string rather than a JSON path filter — same shape as TRIAL_WARNING_ACTIONS. */
export const BACKUP_ALERT_ACTIONS = {
  raised: "backup.alert.raised",
  cleared: "backup.alert.cleared",
} as const;

/** The alert is platform-wide, not per-tenant: one mail lists every affected
 *  restaurant, so the marker cannot hang off a TenantBilling row. */
const ENTITY_TYPE = "Platform";
const ENTITY_ID = "backups";

export type BackupAlertSweepResult = {
  /** "unknown" when the sweep refused to judge (see rule 1). */
  level: BackupAlertLevel | "unknown";
  concerns: number;
  quietBoxes: number;
  /** Tenants a nightly is expected for. */
  watched: number;
  decision: BackupAlertDecision["reason"] | "refused";
  emailed: boolean;
  /** Set iff nothing could be sent that should have been. The cron workflow
   *  fails its run on this field, so a mute alarm is never merely logged. */
  skipped?: "registryUnavailable" | "noFounderInbox" | "sendFailed";
};

/** The last alert we actually sent, whatever kind it was. */
async function lastMarker(): Promise<BackupAlertMarker | null> {
  const row = await db.auditLog.findFirst({
    where: {
      action: { in: Object.values(BACKUP_ALERT_ACTIONS) },
      entityType: ENTITY_TYPE,
      entityId: ENTITY_ID,
    },
    orderBy: { createdAt: "desc" },
    select: { action: true, meta: true, createdAt: true },
  });
  if (!row) return null;
  const meta = (row.meta ?? {}) as { level?: BackupAlertLevel; signature?: string };
  return {
    // A row whose meta lost its level still says WHICH kind it was, and that is
    // the only thing the decision needs from it.
    level: meta.level ?? (row.action === BACKUP_ALERT_ACTIONS.cleared ? "none" : "critical"),
    signature: meta.signature ?? "",
    at: row.createdAt,
  };
}

/** The send itself — `.catch()`ed to a verdict because `sendEmail` swallows a
 *  non-2xx but a DNS/connect failure REJECTS, and an escaping rejection here
 *  would take down the cron route rather than reporting a mute alarm. */
async function send(
  to: string,
  alert: BackupAlert,
  decision: Extract<BackupAlertDecision, { send: true }>,
): Promise<{ sent: boolean }> {
  const failed = { sent: false };
  if (decision.kind === "cleared") {
    return sendBackupClearedEmail({ to, watched: alert.watched }).catch(() => failed);
  }
  return sendBackupAlertEmail({ to, alert, reason: decision.reason }).catch(() => failed);
}

export async function runBackupAlertSweep(now: Date = new Date()): Promise<BackupAlertSweepResult> {
  const { overview, registry } = await loadBackupOverview(now);

  if (!registry.ok) {
    console.error("backup alert sweep: registry unreadable —", registry.error);
    return {
      level: "unknown",
      concerns: 0,
      quietBoxes: overview.quietBoxes,
      watched: 0,
      decision: "refused",
      emailed: false,
      skipped: "registryUnavailable",
    };
  }

  const alert = buildBackupAlert({ rows: overview.rows, boxes: overview.boxes, now });
  const decision = decideBackupAlert({ alert, last: await lastMarker(), now });
  const base = {
    level: alert.level,
    concerns: alert.concerns.length,
    quietBoxes: alert.quietBoxes.length,
    watched: alert.watched,
    decision: decision.reason,
  };
  if (!decision.send) return { ...base, emailed: false };

  const inbox = founderInbox();
  if (!inbox) {
    console.error("backup alert sweep: WAITLIST_TO unset — nobody to alert");
    return { ...base, emailed: false, skipped: "noFounderInbox" };
  }

  const { sent } = await send(inbox, alert, decision);
  if (!sent) {
    // No marker: the next sweep must try again rather than treat this as said.
    console.error("backup alert sweep: send failed —", alert.signature);
    return { ...base, emailed: false, skipped: "sendFailed" };
  }

  await audit(null, BACKUP_ALERT_ACTIONS[decision.kind], ENTITY_TYPE, ENTITY_ID, {
    level: alert.level,
    signature: alert.signature,
    reason: decision.reason,
    concerns: alert.concerns.length,
    quietBoxes: alert.quietBoxes.length,
    watched: alert.watched,
    emailed: true,
  });
  return { ...base, emailed: true };
}
