// WHEN a backup problem is worth an email, and when it has already been said.
//
// `/admin/backups` shouts; nothing reached anybody, because a page is only read
// by someone who already suspects. This module turns the overview into a verdict,
// a list of what is wrong, and a SIGNATURE, then answers "send, or stay quiet?".
//
// Pure by construction — `now`, the rows and the previous marker are all passed
// in. Nothing here reads a clock, a database or the environment, because the two
// ways an alarm fails are the two things that must be unit-testable: it says
// nothing when a restaurant is unprotected, or it says the same thing every day
// until the reader filters it into a folder.

import {
  hoursSince,
  isClusterDumpOnly,
  needsAttention,
  type BackupHealth,
} from "@/lib/backup-health";
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

export type BackupAlertLevel = "none" | "warn" | "critical";

/** One thing that is wrong, as the mail will say it. */
export type BackupConcern = {
  slug: string;
  name: string | null;
  box: string | null;
  health: BackupHealth;
  /** Age of the newest artifact, or null when there has never been one. */
  ageHours: number | null;
  /** True when the box this tenant sits on has stopped reporting, so the age
   *  above is a memory rather than an observation. Annotation, not a trigger:
   *  the quiet box is already alerted on once, by name. */
  boxQuiet: boolean;
  /** True when no off-box copy has arrived within the ship cycle. A trigger in
   *  its own right — a tenant can be here with a perfectly fresh `protected`
   *  verdict beside it, which is exactly the pair worth mailing about. */
  offBoxMissing: boolean;
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

/**
 * Is a nightly expected for this row at all? See NO_NIGHTLY_EXPECTED.
 *
 * `managed: legacy` is skipped too, and that rule now lives in `backup-health.ts`
 * (`isClusterDumpOnly`) rather than here — MEASURED on this sweep's first
 * production run, which alerted `rumi: never` because the deploy repo's
 * `bk_registry_tenants` SKIPS `legacy` when taking per-tenant dumps. Sharing the
 * predicate with the page is the point: the alarm going quiet about a tenant the
 * page still paints red is two answers to one fact.
 */
export function expectsNightly(row: BackupTenantRow): boolean {
  if (row.registryStatus === null) return false;
  if (isClusterDumpOnly(row.managed)) return false;
  return !NO_NIGHTLY_EXPECTED.has(row.registryStatus.toLowerCase());
}

/**
 * Anything other than a recent copy, ON the box or OFF it. `boxQuiet` is not a
 * trigger — the quiet box is already alerted on once, by name.
 *
 * `offBoxMissing` IS one again, as of 2026-08-21. It was dropped on this sweep's
 * first production run because the agent could not see a restic snapshot and
 * reported everything as `local`, which made the flag permanently true for every
 * tenant while the off-box copies demonstrably existed (ADR-014 D5). The agent
 * now enumerates the repository (deploy #139), so the flag says what it means,
 * and it is a state nothing else catches: a tenant dumped perfectly every night
 * whose copies have not LEFT the box since Monday is green by every age rule on
 * this page and one hardware failure from gone.
 */
function isConcerning(row: BackupTenantRow): boolean {
  return needsAttention(row.health) || row.offBoxMissing;
}

function concernOf(row: BackupTenantRow, now: Date): BackupConcern {
  return {
    slug: row.slug,
    name: row.name,
    box: row.box,
    health: row.health,
    ageHours: row.newestTakenAt ? hoursSince(row.newestTakenAt, now) : null,
    boxQuiet: row.boxQuiet,
    offBoxMissing: row.offBoxMissing,
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
    // The off-box half is part of WHAT is wrong, not of how long: a tenant that
    // is `protected` and has nothing off box is a different situation to the same
    // tenant once a copy ships, and the reader must be told when it changes.
    ...alert.concerns.map((c) => `${c.slug}:${c.health}${c.offBoxMissing ? "+offbox" : ""}`),
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
