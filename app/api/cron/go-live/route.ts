import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
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
  // Counts only — never a recipient address in the response or the logs.
  return NextResponse.json(result);
}
