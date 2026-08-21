import { NextResponse } from "next/server";
import { bearerAuthorized } from "@/lib/cron-auth";
import { backupInventorySchema } from "@/lib/backup-contract";
import { ingestBackupInventory } from "@/lib/backup-inventory";

// Machine-to-machine ingest for a box's backup inventory. NOT a (control)
// surface — there is no RBAC session here and there must not be one: a session
// path on this route would be a second way in, and the only caller is a headless
// agent. Guarded by the shared BACKUP_AGENT_SECRET bearer, the same posture as
// PRINTER_TELEMETRY_SECRET (/api/telemetry/fleet) and CRON_SECRET.
//
// AN UNAUTHENTICATED ENDPOINT HERE IS AN INFORMATION LEAK about every tenant we
// hold data for. Not a leak of the data — no dump contents ever enter this app —
// but of the shape of the business: which restaurants exist, how big each one's
// database is, when each was last backed up, and (via `kind: deprovision`) which
// ones have left. That is a competitor's research budget, answered by a curl.
//
// Direction: BOX -> SOFRA, always. This route reads a body; it never calls back.
//
// The response carries COUNTS ONLY. Never a path, never a snapshot ref, never a
// slug — an agent that mis-authenticated to the wrong environment must not learn
// what that environment holds, and echoing the payload back is how a validation
// error becomes an oracle.

export async function POST(request: Request) {
  if (!process.env.BACKUP_AGENT_SECRET) {
    return NextResponse.json({ error: "backup ingest not configured" }, { status: 503 });
  }
  if (!bearerAuthorized(request, process.env.BACKUP_AGENT_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = backupInventorySchema.safeParse(body);
  if (!parsed.success) {
    // Never echo the payload, and never the zod issue list either: the issues
    // name the fields we expect, which is a free map of the contract.
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const result = await ingestBackupInventory(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
