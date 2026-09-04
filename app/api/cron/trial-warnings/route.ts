import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-freshness";
import { runTrialWarningSweep } from "@/lib/trial-warning-notify";

// Machine-to-machine cron endpoint (called by .github/workflows/trial-warning-cron.yml).
// NOT a (control) surface — there is no RBAC session here; it is guarded by the same
// shared CRON_SECRET bearer as /api/cron/go-live and /api/cron/retention
// (lib/cron-auth.ts). Copied deliberately rather than relaxed: an unauthenticated
// endpoint that SENDS MAIL is an open relay for our own sending domain, and
// send.sofrapiwas.com's reputation is what makes every other mail arrive.
//
// Customer-mail class, like the go-live sweep: it warns a payer that their free
// period is ending, at most once per milestone per trial end date. The idempotency
// that makes that true lives in lib/trial-warning-notify.ts (audit-row markers), so a
// double-fired schedule or a manual re-run cannot warn anyone twice.

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runTrialWarningSweep();
  // Heartbeat on EVERY run, whatever the sweep found (#209). The sweeps' own audit rows
  // are written only when they SEND something, so during the six-day Actions outage —
  // when every sweep had nothing to send anyway — a readout built on those rows would
  // have looked identical to a healthy one. This is the row that distinguishes "ran and
  // found nothing" from "never ran".
  await recordCronRun("trial-warnings", result);
  // Counts only — never a recipient address in the response or the logs.
  return NextResponse.json(result);
}
