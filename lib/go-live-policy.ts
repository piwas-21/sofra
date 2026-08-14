// Should this tenant's owner be told their restaurant is live?
//
// The pure half of the go-live notification (EMAIL-SPEC-CONTROL-PLANE G1). Split
// from the sweep for the same reason `tenant-liveness.ts` is split from
// `tenant-health.ts`: this half is total, decidable and unit-testable, and the
// half that touches the network and the database is not.
//
// The gap: the self-serve funnel ends in SILENCE. A buyer configures, pays, and is
// provisioned hands-off -- and nothing ever tells them their restaurant exists. The
// handover is a line printed to the founder's terminal telling THEM to point the
// owner at /forgot-password (deploy/provision-tenant.sh). So the one moment the
// whole funnel is built to deliver is the one moment nobody sends a message about.

import type { TenantStage } from "@/lib/tenant-liveness";

export type GoLiveFacts = {
  /** From `tenantStage()` -- the earned claim, not a guess. */
  stage: TenantStage;
  /** An audit row says we have already announced this tenant. */
  alreadyAnnounced: boolean;
  /** Owner address from the billing row. */
  to: string | null | undefined;
  /** `tenantOrigin(domain)` -- null when the registry domain is not a bare host. */
  origin: string | null;
};

export type GoLiveVerdict =
  | { announce: true; to: string; origin: string }
  | {
      announce: false;
      reason: "notReady" | "alreadyAnnounced" | "noRecipient" | "unusableDomain";
    };

export function goLiveDecision(facts: GoLiveFacts): GoLiveVerdict {
  // ONLY "ready", which `tenantStage` grants solely on an observed health probe
  // against the tenant's own /api/health. Every weaker stage -- an open PR, a
  // registry entry, a timed-out probe -- is explicitly NOT evidence the app serves.
  //
  // This is the rule the whole feature turns on. Announcing from "almostReady"
  // would mail a paying customer a link to a connection error as the very first
  // thing they were ever told to do, which is worse than saying nothing and is
  // exactly what `tenant-liveness.ts` refuses to do on screen. A mail cannot be
  // taken back the way a panel re-renders, so the bar here is if anything higher.
  if (facts.stage !== "ready") return { announce: false, reason: "notReady" };

  // Once, ever. This runs on a schedule, so without a marker a live tenant would be
  // re-announced on every sweep for the rest of its life.
  if (facts.alreadyAnnounced) return { announce: false, reason: "alreadyAnnounced" };

  if (!facts.to) return { announce: false, reason: "noRecipient" };

  // "ready" already implies a registry domain, but the ORIGIN is what the mail turns
  // into links the owner is told to click. Re-checking keeps a malformed entry from
  // producing a mail with a broken button rather than no mail at all.
  if (!facts.origin) return { announce: false, reason: "unusableDomain" };

  return { announce: true, to: facts.to, origin: facts.origin };
}
