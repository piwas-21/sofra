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
 * `managed: legacy` — tenant 1 (ADR-006). MEASURED on this sweep's first
 * production run, which alerted `rumi: never`: the deploy repo's
 * `bk_registry_tenants` SKIPS `legacy` when taking per-tenant dumps, because that
 * database is covered by the whole-cluster dump instead. No per-tenant artifact
 * will ever appear for it, so an age rule applied to it is permanently, unfixably
 * red — the exact "mail nobody can act on" this module exists to avoid, missed in
 * the one case that was live in production. Silence about the per-tenant VIEW,
 * not about the tenant: the cluster dump and the restic ship still cover it.
 */
const NO_PER_TENANT_DUMP = "legacy";

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
  if (row.managed?.toLowerCase() === NO_PER_TENANT_DUMP) return false;
  return !NO_NIGHTLY_EXPECTED.has(row.registryStatus.toLowerCase());
}

/**
 * Anything other than a recent copy. `boxQuiet` is not a trigger — the quiet box
 * is already alerted on once, by name.
 *
 * `singleSiteOnly` is not one either, and that is a CORRECTION from the first
 * production run: the agent CANNOT report an off-box copy (`bk_inventory_json`
 * walks the box filesystem and hard-codes `location: "local"`), while
 * `backup-offsite.sh` ships the whole dump directory into restic — so the flag is
 * permanently true for every tenant and those copies demonstrably do exist off
 * box. A reporting gap, not a protection state; alerting on it says something
 * false every day until it is muted. The page still shows it, beside the artifact
 * list where it can be read for what it is. Re-arm the day the agent enumerates
 * restic snapshots.
 */
function isConcerning(row: BackupTenantRow): boolean {
  return needsAttention(row.health);
}

function concernOf(row: BackupTenantRow, now: Date): BackupConcern {
  return {
    slug: row.slug,
    name: row.name,
    box: row.box,
    health: row.health,
    ageHours: row.newestTakenAt ? hoursSince(row.newestTakenAt, now) : null,
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
    ...alert.concerns.map((c) => `${c.slug}:${c.health}`),
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
