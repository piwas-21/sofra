import { NextResponse } from "next/server";
import { bearerAuthorized } from "@/lib/cron-auth";
import { backupJobResultSchema } from "@/lib/backup-contract";
import { completeJob } from "@/lib/backup-jobs";

// The box reports what happened. Bearer-authed with BACKUP_AGENT_SECRET; no
// session path (see the sibling routes for the credential-direction rule).
//
// Idempotent on purpose: an agent that is unsure its result landed must be able
// to send it again, and a network that ate the response is far likelier than a
// box lying about the same job twice.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.BACKUP_AGENT_SECRET) {
    return NextResponse.json({ error: "backup jobs not configured" }, { status: 503 });
  }
  if (!bearerAuthorized(request, process.env.BACKUP_AGENT_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = backupJobResultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const outcome = await completeJob(id, parsed.data);
  if (outcome === "notFound") {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
