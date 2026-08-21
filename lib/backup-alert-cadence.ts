// HOW OFTEN the same news is said — the second half of the alarm's judgement.
//
// Split from `backup-alert-policy.ts` along the seam the feature already had, the
// same split as trial-warning-{policy,candidates}: that module answers *what is
// wrong*, this one answers *whether to say it again*. Kept apart because a
// reviewer checking "can this mail me daily forever?" should be able to read the
// whole answer on one screen instead of finding it after the health rules.
//
// Pure: `now` and the previous marker are passed in.

import { hoursSince } from "@/lib/backup-health";
import type { BackupAlert, BackupAlertLevel } from "@/lib/backup-alert-policy";

/**
 * How long the same unchanged problem waits before being said again.
 *
 * Not the sweep's cadence — the sweep runs more often than this, and on most
 * runs it decides to say nothing. `critical` re-nags daily because a restaurant
 * whose data is aging out is a thing that must not slip a day; `warn` waits
 * three, because one missed nightly usually heals on the next one and a mail per
 * day about a self-healing blip is the fastest way to train someone to ignore
 * the sender. A `warn` that does NOT heal crosses 72h and becomes `critical` by
 * itself, which is when the cadence tightens.
 */
export const REMINDER_HOURS: Record<"warn" | "critical", number> = { warn: 72, critical: 24 };

/** The last alert actually SENT — read from the audit log by the sweep. */
export type BackupAlertMarker = { level: BackupAlertLevel; signature: string; at: Date };

export type BackupAlertDecision =
  | { send: false; reason: "healthy" | "unchanged" }
  | { send: true; kind: "raised"; reason: "new" | "changed" | "reminder" }
  | { send: true; kind: "cleared"; reason: "recovered" };

/**
 * Say it, say it again, or say nothing.
 *
 * The `recovered` branch is the one that is easy to leave out and is what makes
 * the rest trustworthy: an alarm you never hear the end of is one you stop
 * reading, so the sweep closes its own loop exactly once and then goes quiet.
 * Its marker is what makes the NEXT problem read as `new` rather than as more of
 * the old one.
 */
export function decideBackupAlert(input: {
  alert: Pick<BackupAlert, "level" | "signature">;
  last: BackupAlertMarker | null;
  now: Date;
}): BackupAlertDecision {
  const { alert, last, now } = input;
  if (alert.level === "none") {
    if (last && last.level !== "none") return { send: true, kind: "cleared", reason: "recovered" };
    return { send: false, reason: "healthy" };
  }
  if (!last || last.level === "none") return { send: true, kind: "raised", reason: "new" };
  if (last.signature !== alert.signature) return { send: true, kind: "raised", reason: "changed" };
  if (hoursSince(last.at, now) >= REMINDER_HOURS[alert.level]) {
    return { send: true, kind: "raised", reason: "reminder" };
  }
  return { send: false, reason: "unchanged" };
}
