import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { fleetPushSchema, ingestFleetPush } from "@/lib/fleet";

// Machine-to-machine ingest for the fleet roll-up: each tenant backend's FleetSummaryPushService
// POSTs a compact per-tenant snapshot here. NOT a (control) surface — no RBAC session; guarded by a
// shared PRINTER_TELEMETRY_SECRET bearer token. One-directional (backend → sofra): devices/backends
// hold no sofra credential, sofra holds no backend credential. Non-PII (schema-enforced).
//
// TRUST MODEL (follow-up): the bearer is a single shared machine secret and the tenant is taken from
// the body's tenantSlug, so any secret-holder could write/prune another tenant's rows. Blast radius
// is bounded — internal admin-only view, non-PII, self-heals on the next legitimate push, one tenant
// today. When the backend push slice lands, bind the slug to a per-tenant credential.

// Constant-time bearer check. Both sides are SHA-256'd to a fixed 32 bytes first so timingSafeEqual
// never sees a length mismatch (which would throw and leak the secret's length via timing).
function authorized(request: Request): boolean {
  const secret = process.env.PRINTER_TELEMETRY_SECRET;
  if (!secret) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const provided = digest(request.headers.get("authorization") ?? "");
  const expected = digest(`Bearer ${secret}`);
  return timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  if (!process.env.PRINTER_TELEMETRY_SECRET) {
    return NextResponse.json({ error: "fleet telemetry not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = fleetPushSchema.safeParse(body);
  if (!parsed.success) {
    // Never echo the payload — just that it was malformed.
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  await ingestFleetPush(parsed.data);
  return NextResponse.json({ ok: true, devices: parsed.data.devices.length });
}
