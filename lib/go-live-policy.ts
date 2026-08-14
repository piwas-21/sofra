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
  /** When this tenant's first payment settled, or null if none has. */
  firstPaidAt: Date | null;
  /**
   * The plan is held by a reseller CLIENT rather than a direct owner
   * (`TenantBilling.clientId` set; ADR-004's clientId XOR payerUserId).
   *
   * Those tenants are NOT ours to write to. The partner owns the customer
   * relationship — that is what white-label resale means — and they run the
   * handover themselves. Measured on the live data, `TenantBilling.email` for a
   * reseller plan is the PARTNER's address, not the restaurant's (tenant 1's
   * restaurant has no address on file at all), so "your restaurant is live, set
   * your admin password" would be sent to the wrong person about someone else's
   * customer, in a voice the partner never agreed to.
   */
  partnerManaged: boolean;
  /**
   * NO RETROACTIVE ANNOUNCEMENTS. Tenants that went live before this feature
   * existed were handed over by the old manual path and must never be "announced".
   *
   * This is not hypothetical: measured against the live control plane before merge,
   * the sweep's candidate set included **tenant 1 (RUMI)** -- paid, in the registry,
   * and answering `/api/health` -- so without this guard its owner, a real paying
   * client live since June, would have been mailed "your restaurant is live 🎉,
   * set your admin password" for a restaurant that has been running for a year.
   * Announcing is not idempotent with respect to REALITY, only to our own log.
   */
  announceFrom: Date;
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
      reason:
        | "notReady"
        | "partnerManaged"
        | "predatesFeature"
        | "alreadyAnnounced"
        | "noRecipient"
        | "unusableDomain";
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

  // Checked BEFORE the announced-marker so a pre-existing tenant reports the real
  // reason it is being passed over, and so the sweep can filter on it without a
  // probe. A tenant with no settled payment cannot be announced either -- it is not
  // a customer yet, and `null` must never read as "old enough".
  if (facts.partnerManaged) return { announce: false, reason: "partnerManaged" };

  if (!facts.firstPaidAt || facts.firstPaidAt < facts.announceFrom) {
    return { announce: false, reason: "predatesFeature" };
  }

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
