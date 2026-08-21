// The BOX half of /admin/backups, extracted from `backup-overview.ts`.
//
// A box row answers a different question to a tenant row — "is this machine still
// talking to us", not "is this restaurant's data protected" — and the answer
// changes what every tenant row on it MEANS: when a box is quiet, its tenants'
// ages are a memory of that box rather than an observation of it.

import { boxIsQuiet } from "@/lib/backup-health";

/** One box's last inventory push, as the ingest recorded it. `reportedAt` is the
 *  box's own clock, `receivedAt` ours — quietness is judged on OURS, because a
 *  box with a wrong clock must not be able to claim it spoke recently. */
export type BoxFact = { box: string; reportedAt: Date; receivedAt: Date };

export type BackupBoxRow = {
  box: string;
  lastReportAt: Date | null;
  quiet: boolean;
  artifacts: number;
};

/** Which boxes are quiet, keyed by box — the tenant rows need this too. */
export function quietBoxMap(reports: readonly BoxFact[], now: Date): Map<string, boolean> {
  return new Map(reports.map((b) => [b.box, boxIsQuiet(b.receivedAt, now)]));
}

/** Every box that has ever pushed, with its artifact count. Sorted by name with
 *  an explicit comparator: these names reach the alarm's signature, and a
 *  locale-dependent reordering would read as a changed situation. */
export function buildBoxRows(
  reports: readonly BoxFact[],
  artifacts: readonly { box: string }[],
  quiet: Map<string, boolean>,
): BackupBoxRow[] {
  return reports
    .map((b) => ({
      box: b.box,
      lastReportAt: b.receivedAt,
      quiet: quiet.get(b.box) ?? true,
      artifacts: artifacts.filter((a) => a.box === b.box).length,
    }))
    .sort((a, b) => a.box.localeCompare(b.box));
}
