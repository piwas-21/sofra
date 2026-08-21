// WHEN a backup problem is worth an email, and when it has already been said.
//
// `/admin/backups` shouts; nothing reached anybody. A page is only read by
// someone who already suspects — the tenant that has silently fallen out of the
// nightly is exactly the one nobody opens the page for. This module is the half
// of the fix that can be reasoned about: it turns the overview into a verdict, a
// list of what is wrong, and a SIGNATURE, then answers "send, or stay quiet?".
//
// Pure by construction — `now`, the rows and the previous marker are all passed
// in. Nothing here reads a clock, a database or the environment, because the two
// ways an alarm fails are the two things that must be unit-testable: it says
// nothing when a restaurant is unprotected, or it says the same thing every day
// until the reader filters it into a folder.

import { hoursSince, needsAttention, type BackupHealth } from "@/lib/backup-health";
import type { BackupBoxRow, BackupTenantRow } from "@/lib/backup-overview";

/**
 * Registry statuses for which NO nightly is expected, and therefore for which
 * silence is not evidence of anything.
 *
 * `provisioning` has no database yet; `retired`/`deprovisioned`/`archived` are
 * the departed customer whose copies we deliberately keep and deliberately stop
 * refreshing — `backup-retention.ts` renders their "kept until" date, and to an
 * alarm they are permanently, unfixably `unprotected`. Alerting on them would
 * produce a red mail nobody can ever act on, which is how an alarm gets muted.
 *
 * An UNKNOWN status is watched, not skipped: a typo in the registry must make
 * this noisier, never quieter.
 */
const NO_NIGHTLY_EXPECTED = new Set(["provisioning", "retired", "deprovisioned", "archived"]);

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

export type BackupAlertLevel = "none" | "warn" | "critical";

/** One thing that is wrong, as the mail will say it. */
export type BackupConcern = {
  slug: string;
  name: string | null;
  box: string | null;
  health: BackupHealth;
  /** Age of the newest artifact, or null when there has never been one. */
  ageHours: number | null;
  singleSiteOnly: boolean;
  /** True when the box this tenant sits on has stopped reporting, so the age
   *  above is a memory rather than an observation. Annotation, not a trigger:
   *  the quiet box is already alerted on once, by name. */
  boxQuiet: boolean;
};

export type BackupAlert = {
  level: BackupAlertLevel;
  /** Worst first — the row order `buildBackupOverview` already sorted. */
  concerns: BackupConcern[];
  quietBoxes: string[];
  /** No box has EVER pushed an inventory. Every age on the platform is then
   *  absent rather than fresh, and the likeliest cause is that the agent was
   *  never deployed — the one failure that looks identical to "no backups yet". */
  noBoxHasEverReported: boolean;
  /** Tenants a nightly is actually expected for. The denominator of the mail. */
  watched: number;
  /** What this alert IS, independent of how long it has been true. Two runs that
   *  produce the same string are the same news, and the second one is not sent. */
  signature: string;
};

/** Is a nightly expected for this row at all? See NO_NIGHTLY_EXPECTED. */
export function expectsNightly(row: BackupTenantRow): boolean {
  if (row.registryStatus === null) return false;
  return !NO_NIGHTLY_EXPECTED.has(row.registryStatus.toLowerCase());
}

/** Anything other than a fresh, off-box copy. `boxQuiet` is deliberately not a
 *  trigger here — see BackupConcern. */
function isConcerning(row: BackupTenantRow): boolean {
  return needsAttention(row.health) || row.singleSiteOnly;
}

function concernOf(row: BackupTenantRow, now: Date): BackupConcern {
  return {
    slug: row.slug,
    name: row.name,
    box: row.box,
    health: row.health,
    ageHours: row.newestTakenAt ? hoursSince(row.newestTakenAt, now) : null,
    singleSiteOnly: row.singleSiteOnly,
    boxQuiet: row.boxQuiet,
  };
}

/** Red rather than amber: data that is aging out, or was never there at all. */
function isCritical(c: BackupConcern): boolean {
  return c.health === "unprotected" || c.health === "never";
}

/**
 * The signature is what makes a repeated alarm quiet without making it forgetful.
 *
 * It carries WHAT is wrong (each tenant and its verdict, each quiet box) and
 * deliberately NOT how long it has been wrong: including the age would change the
 * string on every run, so every run would look like news and the reminder policy
 * below would never get a say. Human-readable rather than hashed — it is written
 * into the audit log, and an operator reading that row should be able to see what
 * the mail said without decoding anything.
 */
export function alertSignature(alert: Omit<BackupAlert, "signature">): string {
  const parts = [
    alert.level,
    ...alert.concerns.map((c) => `${c.slug}:${c.health}${c.singleSiteOnly ? "+localOnly" : ""}`),
    ...alert.quietBoxes.map((b) => `quiet:${b}`),
  ];
  if (alert.noBoxHasEverReported) parts.push("noBoxHasEverReported");
  return parts.join("|");
}

export function buildBackupAlert(input: {
  rows: readonly BackupTenantRow[];
  boxes: readonly BackupBoxRow[];
  now: Date;
}): BackupAlert {
  const watchedRows = input.rows.filter(expectsNightly);
  const concerns = watchedRows.filter(isConcerning).map((r) => concernOf(r, input.now));
  const quietBoxes = input.boxes
    .filter((b) => b.quiet)
    .map((b) => b.box)
    // An explicit comparator, not a bare `.sort()`: the default sorts by UTF-16
    // code unit, and the box names are part of the SIGNATURE — a locale-dependent
    // reordering would read as a changed situation and re-send an unchanged alert.
    .sort((a, b) => a.localeCompare(b));
  const noBoxHasEverReported = input.boxes.length === 0;

  const critical = concerns.some(isCritical) || quietBoxes.length > 0 || noBoxHasEverReported;
  let level: BackupAlertLevel = "none";
  if (critical) level = "critical";
  else if (concerns.length > 0) level = "warn";

  const alert = {
    level,
    concerns,
    quietBoxes,
    noBoxHasEverReported,
    watched: watchedRows.length,
  };
  return { ...alert, signature: alertSignature(alert) };
}

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
