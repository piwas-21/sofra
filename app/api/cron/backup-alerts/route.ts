import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-freshness";
import { runBackupAlertSweep } from "@/lib/backup-alert-notify";

// Machine-to-machine cron endpoint (called by .github/workflows/backup-alert-cron.yml).
// NOT a (control) surface — there is no RBAC session here; it is guarded by the same
// shared CRON_SECRET bearer as /api/cron/{retention,go-live,trial-warnings}
// (lib/cron-auth.ts). Copied deliberately rather than relaxed: an unauthenticated
// endpoint that SENDS MAIL is an open relay for our own sending domain, and
// send.sofrapiwas.com's reputation is what makes every other mail arrive.
//
// Founder-mail class, and internal: it reports which tenants' data is not protected
// (ADR-014 D5). No customer receives it. Safe to re-run by hand — the sweep decides
// from an audit-log marker, not from the schedule, so a double-fired cron or a manual
// dispatch says nothing new.
//
// Always 200 when it ran, even when it could not mail: the result carries `skipped`,
// and the workflow FAILS its run on that field. A mute alarm has to be visible
// somewhere, and a 500 here would be indistinguishable from the container being down.

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runBackupAlertSweep();
  // Heartbeat on EVERY run, whatever the sweep found (#209). The sweeps' own audit rows
  // are written only when they SEND something, so during the six-day Actions outage —
  // when every sweep had nothing to send anyway — a readout built on those rows would
  // have looked identical to a healthy one. This is the row that distinguishes "ran and
  // found nothing" from "never ran".
  await recordCronRun("backup-alerts", result);
  // Counts, slugs-free: the recipient address never appears in a response or a log.
  return NextResponse.json(result);
}
