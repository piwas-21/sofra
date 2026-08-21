import { NextResponse } from "next/server";
import { bearerAuthorized } from "@/lib/cron-auth";
import { backupBoxQuerySchema } from "@/lib/backup-contract";
import { claimJobsForBox } from "@/lib/backup-jobs";

// The box PULLS its work from here. Bearer-authed with BACKUP_AGENT_SECRET; no
// session path, and no RBAC bypass through it — nothing a founder can do on
// /admin/backups is reachable on this route, and nothing here reads a cookie.
//
// WHY A PULL AND NOT A PUSH, written where the decision lives: sofra holds no
// credential that can reach a box and must not (ADR-012 invariant 2). It cannot
// SSH, and it deliberately does not dispatch a GitHub workflow either — the
// `Actions: write` scope that would allow cannot be narrowed to a single
// workflow (workspace docs/runbooks/signup-to-live-tenant.md §0b), so the token
// that dispatched `backup-tenant.yml` could equally dispatch
// `deprovision-tenant.yml --drop-db`. A backup feature must not hand its own
// container a tenant-destruction primitive. So the founder's click writes a row
// and the box comes for it; the cost is one poll of latency, and a backup is not
// interactive.
//
// It is a GET that WRITES (it leases the jobs it hands out), which is worth
// stating rather than hiding. The contract fixes the verb, and the usual reasons
// not to do this do not apply: there is no cookie auth on this route, so there
// is no CSRF surface, and no browser or crawler can reach it without the bearer.
// The write is idempotent in effect — a re-claim of the same job by the same box
// is the intended path, and the lease exists precisely so a lost claim is
// re-offered.

export async function GET(request: Request) {
  if (!process.env.BACKUP_AGENT_SECRET) {
    return NextResponse.json({ error: "backup jobs not configured" }, { status: 503 });
  }
  if (!bearerAuthorized(request, process.env.BACKUP_AGENT_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const box = backupBoxQuerySchema.safeParse(new URL(request.url).searchParams.get("box"));
  if (!box.success) {
    return NextResponse.json({ error: "box is required" }, { status: 400 });
  }

  const jobs = await claimJobsForBox(box.data);
  // Slugs and refs DO travel here — they are the job. That is the difference
  // between this route and the ingest's response: this one is answering a box
  // that is about to act on a specific tenant, and it cannot act without knowing
  // which. It still carries no reason, no requester and no plan data.
  return NextResponse.json({ jobs });
}
