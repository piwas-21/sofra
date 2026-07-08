import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { retentionConfig } from "@/lib/retention-policy";
import { runRetention } from "@/lib/retention";

// Machine-to-machine cron endpoint (called by .github/workflows/retention-cron.yml).
// NOT a (control) surface — there is no RBAC session here; it is guarded by a shared
// CRON_SECRET bearer token. Data-loss class: the sweep only runs when
// RETENTION_ENABLED=true (enforced in retentionConfig()/runRetention()).

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

  const config = retentionConfig();
  if (!config.enabled) {
    return NextResponse.json({ enabled: false, message: "retention disabled (set RETENTION_ENABLED=true)" });
  }

  const deleted = await runRetention(new Date(), config);
  // Counts only — never any PII in the response or logs.
  return NextResponse.json({ enabled: true, deleted });
}
