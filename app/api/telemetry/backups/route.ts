import { NextResponse } from "next/server";
import { authenticatedBox, backupAgentConfigured, boxAuthorized } from "@/lib/backup-agent-auth";
import { backupInventorySchema } from "@/lib/backup-contract";
import { ingestBackupInventory } from "@/lib/backup-inventory";

// Machine-to-machine ingest for a box's backup inventory. NOT a (control)
// surface — there is no RBAC session here and there must not be one: a session
// path on this route would be a second way in, and the only caller is a headless
// agent. Guarded by a PER-BOX bearer (`BACKUP_AGENT_SECRET_<BOX>`, with the old
// shared `BACKUP_AGENT_SECRET` still accepted during the rollout), the same posture
// as PRINTER_TELEMETRY_SECRET (/api/telemetry/fleet) and CRON_SECRET.
//
// The bearer must match the box the BODY claims to be. That binding is the point:
// this push PRUNES what it stops listing, so without it any box's credential could
// erase the control plane's record of ANY other box's backups — see
// lib/backup-agent-auth.ts for the argument.
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
  if (!backupAgentConfigured()) {
    return NextResponse.json({ error: "backup ingest not configured" }, { status: 503 });
  }
  // Authenticated BEFORE the body is read, as before: an unauthenticated caller
  // must not be able to make this route parse anything.
  const agent = authenticatedBox(request);
  if (!agent) {
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

  if (!boxAuthorized(agent, parsed.data.box)) {
    // 403, not 401: the credential is real, it is simply not this box's. It tells
    // the caller nothing it did not already know (its own box), and it is the
    // difference an operator needs when an agent is pointed at the wrong value.
    return NextResponse.json({ error: "box mismatch" }, { status: 403 });
  }

  const result = await ingestBackupInventory(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
