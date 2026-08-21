import { NextResponse } from "next/server";
import { authenticatedBox, backupAgentConfigured, boxAuthorized } from "@/lib/backup-agent-auth";
import { backupJobResultSchema } from "@/lib/backup-contract";
import { completeJob } from "@/lib/backup-jobs";

// The box reports what happened. Bearer-authed PER BOX (`BACKUP_AGENT_SECRET_<BOX>`,
// the shared `BACKUP_AGENT_SECRET` still accepted during the rollout); no session
// path (see the sibling routes for the credential-direction rule).
//
// A result for ANOTHER box's job answers 404, the same as an unknown id: a job is
// not a thing a box that does not own it may confirm the existence of.
//
// Idempotent on purpose: an agent that is unsure its result landed must be able
// to send it again, and a network that ate the response is far likelier than a
// box lying about the same job twice.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!backupAgentConfigured()) {
    return NextResponse.json({ error: "backup jobs not configured" }, { status: 503 });
  }
  const agent = authenticatedBox(request);
  if (!agent) {
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

  const outcome = await completeJob(id, parsed.data, (job) => boxAuthorized(agent, job.box));
  if (outcome === "notFound") {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
