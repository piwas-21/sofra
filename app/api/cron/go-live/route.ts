import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runGoLiveSweep } from "@/lib/go-live-notify";

// Machine-to-machine cron endpoint (called by .github/workflows/go-live-cron.yml).
// NOT a (control) surface — there is no RBAC session here; it is guarded by the same
// shared CRON_SECRET bearer token as /api/cron/retention.
//
// Unlike the retention sweep this is not data-loss class, but it IS customer-mail
// class: it announces a live restaurant to its owner exactly once. The idempotency
// that makes that true lives in lib/go-live-notify.ts (an audit-row marker), so a
// double-fired schedule or a manual re-run cannot re-announce anyone.

// Constant-time bearer check. Both sides are SHA-256'd to a fixed 32 bytes first so
// timingSafeEqual never sees a length mismatch (which would throw and also leak the
// secret's length via timing).
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const provided = digest(request.headers.get("authorization") ?? "");
  const expected = digest(`Bearer ${secret}`);
  return timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runGoLiveSweep();
  // Counts only — never a recipient address in the response or the logs.
  return NextResponse.json(result);
}
