import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-freshness";
import { runGoLiveSweep } from "@/lib/go-live-notify";

// Machine-to-machine cron endpoint (called by .github/workflows/go-live-cron.yml).
// NOT a (control) surface — there is no RBAC session here; it is guarded by the same
// shared CRON_SECRET bearer token as /api/cron/retention (lib/cron-auth.ts).
//
// Unlike the retention sweep this is not data-loss class, but it IS customer-mail
// class: it announces a live restaurant to its owner exactly once. The idempotency
// that makes that true lives in lib/go-live-notify.ts (an audit-row marker), so a
// double-fired schedule or a manual re-run cannot re-announce anyone.

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runGoLiveSweep();
  // Heartbeat on EVERY run, whatever the sweep found (#209). The sweeps' own audit rows
  // are written only when they SEND something, so during the six-day Actions outage —
  // when every sweep had nothing to send anyway — a readout built on those rows would
  // have looked identical to a healthy one. This is the row that distinguishes "ran and
  // found nothing" from "never ran".
  await recordCronRun("go-live", result);
  // Counts only — never a recipient address in the response or the logs.
  return NextResponse.json(result);
}
