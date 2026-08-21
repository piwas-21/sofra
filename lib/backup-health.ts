// Is a tenant's data actually protected right now? — the whole judgement, pure.
//
// A backup page that lists successes is how people find out too late. The single
// most valuable thing on /admin/backups is the tenant that is NOT there, so the
// rules that decide "not there" live in one tested place rather than inline in a
// component where an inverted comparison renders as calm green text.
//
// Pure by construction: `now` is always passed in, nothing is read from the
// clock, the database or the environment. Every threshold below is a constant
// with its measurement written next to it.

/**
 * MEASURED CADENCE (both boxes, 2026-08-20). Each box dumps nightly at **02:15**;
 * prod ships cross-box into the restic repositories at **03:00**. So a healthy
 * tenant gains one artifact every 24 hours, and the newest one is at most ~24h
 * old at any moment plus however long the run takes.
 */
export const NIGHTLY_INTERVAL_HOURS = 24;

/**
 * **> 36h ⇒ stale.** One full nightly cycle plus a twelve-hour grace.
 *
 * The grace is not padding. Below 24h+something, a perfectly healthy tenant
 * reads stale for part of every single day, which trains the reader to ignore
 * the colour — the failure mode that makes a monitoring page worse than none.
 * Twelve hours absorbs a late start, a slow dump, a cross-box ship that queued
 * behind another, and clock skew between the box and this container. It does NOT
 * absorb a missed run: at 36h the 02:15 nightly has definitively not happened,
 * and that is worth a human looking.
 */
export const STALE_AFTER_HOURS = 36;

/**
 * **> 72h ⇒ unprotected.** Three consecutive nightlies missed.
 *
 * One miss is an incident; three in a row is a schedule that is broken and will
 * stay broken, and by then the newest copy of that restaurant's menu predates
 * three days of orders, prices and reservations. The two-tier split exists so the
 * page can say "look at this today" without spending the same alarm on both — if
 * everything above 36h were red, red would mean nothing.
 */
export const UNPROTECTED_AFTER_HOURS = 72;

/**
 * **> 6h with no inventory ⇒ the box has gone quiet.**
 *
 * The agent polls for jobs every 5 minutes and pushes its inventory at least
 * hourly, so six hours is six missed pushes — beyond a reboot, a deploy window
 * or a transient network fault, and squarely into "this box is not talking to
 * us". It matters more than it looks: when a box is quiet, every per-tenant age
 * on this page is a stale MEMORY of that box, not an observation. The tenants
 * under it are not known-protected; they are unknown, and the page says so.
 */
export const BOX_QUIET_AFTER_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

/** Whole hours since `then`, floored, never negative. A future timestamp (box
 *  clock ahead of ours) reads 0 rather than a negative age that would compare
 *  as "fresher than fresh" — a wrong clock must not be able to silence a
 *  staleness alarm. */
export function hoursSince(then: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / HOUR_MS));
}

export type BackupHealth =
  /** A recent artifact exists. */
  | "protected"
  /** One nightly has been missed. Worth a look, not yet an emergency. */
  | "stale"
  /** Three or more missed. This tenant's data is aging out of protection. */
  | "unprotected"
  /** The registry knows this tenant and no artifact has EVER been reported. */
  | "never";

export type TenantBackupFacts = {
  /** How many artifacts we hold for this tenant, across every box and location. */
  artifactCount: number;
  /** When the newest of them was taken. Null iff `artifactCount` is 0. */
  newestTakenAt: Date | null;
  /** How many of them live in an encrypted OFF-box restic repository. */
  offBoxCount: number;
};

/**
 * The verdict for one tenant.
 *
 * `never` outranks `unprotected` deliberately. Both are red, but they are
 * different problems and get different answers: an aged-out tenant means the
 * schedule broke, whereas a tenant with zero artifacts usually means it was
 * never wired into the backup at all — a provisioning gap, not an ops one, and
 * the one that silently survives every green nightly run.
 */
export function backupHealth(facts: TenantBackupFacts, now: Date): BackupHealth {
  if (facts.artifactCount === 0 || !facts.newestTakenAt) return "never";
  const age = hoursSince(facts.newestTakenAt, now);
  if (age > UNPROTECTED_AFTER_HOURS) return "unprotected";
  if (age > STALE_AFTER_HOURS) return "stale";
  return "protected";
}

/** Severity order, for sorting the page so the worst is first. Higher is worse. */
const SEVERITY: Record<BackupHealth, number> = {
  protected: 0,
  stale: 1,
  unprotected: 2,
  never: 3,
};

export function healthSeverity(health: BackupHealth): number {
  return SEVERITY[health];
}

/** Everything except `protected` — what the page counts in its alarm line. */
export function needsAttention(health: BackupHealth): boolean {
  return health !== "protected";
}

/**
 * A tenant whose every copy sits on the box that also runs it.
 *
 * Called out separately from staleness because it is a different kind of not-
 * protected and the two are easy to conflate: a nightly dump written next to the
 * database it came from is fresh, green by every age rule above, and gone with
 * the box. Only an off-box (restic) copy survives the failure people actually
 * take backups for. Silent when there are no artifacts at all — that is `never`,
 * and saying both would be two alarms for one problem.
 */
export function isSingleSiteOnly(facts: TenantBackupFacts): boolean {
  return facts.artifactCount > 0 && facts.offBoxCount === 0;
}

/**
 * `managed: legacy` — the registry value for a tenant the box never dumps ON ITS
 * OWN (tenant 1, ADR-006). `bk_registry_tenants` skips it and its database rides
 * the whole-cluster dump instead, which is shipped off-box with the rest.
 *
 * Here rather than in the alarm because both the alarm and the PAGE need it and
 * they must not be able to disagree: the alarm learned this on its first
 * production run (ADR-014 D5) and went quiet about `rumi`, while the page kept
 * rendering the same tenant red `never` — one fact, two answers, and the red one
 * is the one that teaches a reader to ignore the colour.
 */
const NO_PER_TENANT_DUMP = "legacy";

/**
 * Is this tenant covered ONLY by the whole-cluster dump?
 *
 * Not a health state and deliberately not part of `backupHealth`: the health of
 * a per-tenant artifact that will never exist is not `never`, it is a question
 * that does not apply. Callers use this to stop asking it — the alarm to skip
 * the row, the page to say what covers the tenant instead.
 */
export function isClusterDumpOnly(managed: string | null | undefined): boolean {
  return managed?.toLowerCase() === NO_PER_TENANT_DUMP;
}

/** Has a box stopped reporting? `null` = it has never reported at all. */
export function boxIsQuiet(lastReportAt: Date | null, now: Date): boolean {
  if (!lastReportAt) return true;
  return hoursSince(lastReportAt, now) >= BOX_QUIET_AFTER_HOURS;
}

/** Total bytes across a set of artifacts, as a `number` for display.
 *
 *  Sizes arrive as `bigint` from Prisma. Summing them as bigint and converting
 *  ONCE at the end keeps the arithmetic exact; a per-item `Number()` would lose
 *  precision in principle and, more usefully, this is the only place the
 *  conversion happens, so there is one line to audit rather than three. */
export function totalBytes(sizes: readonly bigint[]): number {
  return Number(sizes.reduce((acc, s) => acc + s, 0n));
}
