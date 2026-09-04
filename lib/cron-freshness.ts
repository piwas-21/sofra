import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Cron freshness (#209) — "when did each sweep last actually RUN?".
 *
 * ## Why this needed a new write path after all
 *
 * The issue proposed deriving this from the audit rows the sweeps already write, with no
 * new write path. That does not work, and the reason is the whole point of the feature:
 * **a sweep only writes an audit row when it SENDS something.**
 * `runTrialWarningSweep` returns early on `todo.length === 0` and writes nothing; the
 * go-live marker is written inside the per-candidate loop.
 *
 * During the six-day outage every sweep had nothing to send anyway — the incident report
 * records both hand-dispatched sweeps returning `considered: 0`. So a readout built on
 * those rows would have shown exactly the same thing whether the crons ran or not: it
 * would have been GREEN for all six days. A freshness signal that cannot distinguish
 * "ran and found nothing" from "never ran" is not a freshness signal.
 *
 * So each sweep records a heartbeat on EVERY run. It goes in `AuditLog`, which already
 * exists — no schema change, and therefore no Prisma migration against the database
 * holding partner, billing and CRM records.
 */

export const CRON_RAN_ACTION = "cron.ran";
export const CRON_ENTITY = "Cron";

/**
 * Every sweep, with how stale it is allowed to get before the readout calls it overdue.
 *
 * The budget is deliberately GENEROUS — roughly two-and-a-bit missed runs, not one.
 * GitHub's scheduled runs are best-effort and routinely drift by tens of minutes under
 * load; a threshold of one interval would cry most days, and an alarm that cries most
 * days is the one nobody reads. The failure being caught here lasted six DAYS.
 */
export const CRON_SWEEPS = {
  "trial-warnings": { label: "Trial warnings", everyMs: 24 * 60 * 60 * 1000, budgetMs: 30 * 60 * 60 * 1000 },
  "go-live": { label: "Go-live announcements", everyMs: 15 * 60 * 1000, budgetMs: 2 * 60 * 60 * 1000 },
  "backup-alerts": { label: "Backup alerts", everyMs: 12 * 60 * 60 * 1000, budgetMs: 18 * 60 * 60 * 1000 },
  retention: { label: "Retention sweep", everyMs: 24 * 60 * 60 * 1000, budgetMs: 30 * 60 * 60 * 1000 },
} as const;

export type CronSweep = keyof typeof CRON_SWEEPS;

export type CronFreshnessRow = {
  sweep: CronSweep;
  label: string;
  lastRunAt: Date | null;
  ageMs: number | null;
  budgetMs: number;
  /** `never` is its own state: "no heartbeat ever" and "a heartbeat six days old" need different words. */
  status: "fresh" | "overdue" | "never";
};

/**
 * Called by each cron route AFTER the sweep returns, whatever it found. Fire-and-forget,
 * like every other `audit()` call: a heartbeat that could fail a sweep would make the
 * monitoring more dangerous than the thing it monitors.
 *
 * `result` is the sweep's own counts — no addresses, no tenant PII (CLAUDE.md §5.8).
 */
export async function recordCronRun(sweep: CronSweep, result: unknown): Promise<void> {
  await audit(null, CRON_RAN_ACTION, CRON_ENTITY, sweep, { result });
}

/** One row per sweep, newest heartbeat each, ordered as declared. */
export async function cronFreshness(now: Date = new Date()): Promise<CronFreshnessRow[]> {
  const sweeps = Object.keys(CRON_SWEEPS) as CronSweep[];

  // One query, not one per sweep: `groupBy` with `_max` is what makes this a single
  // index scan on (action, entityId) rather than four round trips to the same table.
  const latest = await db.auditLog.groupBy({
    by: ["entityId"],
    where: { action: CRON_RAN_ACTION, entityType: CRON_ENTITY, entityId: { in: sweeps } },
    _max: { createdAt: true },
  });

  const seen = new Map(latest.map((r) => [r.entityId, r._max.createdAt]));

  return sweeps.map((sweep) => {
    const { label, budgetMs } = CRON_SWEEPS[sweep];
    const lastRunAt = seen.get(sweep) ?? null;
    if (!lastRunAt) {
      return { sweep, label, lastRunAt: null, ageMs: null, budgetMs, status: "never" as const };
    }
    const ageMs = now.getTime() - lastRunAt.getTime();
    return {
      sweep,
      label,
      lastRunAt,
      ageMs,
      budgetMs,
      status: ageMs > budgetMs ? ("overdue" as const) : ("fresh" as const),
    };
  });
}
