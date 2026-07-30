// "Where is my restaurant app?" — the owner-facing stage of a paid tenant
// (SOFRA-ONBOARDING-PLAN O4, inheriting O3's credential handover).
//
// O3 built the mechanism that means no password ever leaves the box: the tenant
// frontend now has /forgot-password + /reset-password, so the owner sets their own
// admin password. What it did not build is the sentence that tells them so. This
// module answers the one question that sentence depends on — *is their app actually
// up yet?* — and the answer has to be EARNED, because the panel it drives sends the
// owner to a URL. Telling someone "your app is ready" and landing them on a
// connection error is worse than telling them nothing.
//
// There is no clean "is the tenant live" signal in this system today, and this file
// is where that was decided rather than assumed:
//
//   - `TenantBilling.liveSince` is admin-entered and display-only. It is a date the
//     founder typed, not an observation, and on the self-serve path nobody types it.
//   - the registry's `status: active` is a manual follow-up commit that nothing
//     automatic writes and nothing automatic reads. `provision-on-registry-merge.yml`
//     does not flip it.
//   - `provisioningPrUrl` proves a proposal was OPENED, not merged, built or booted.
//   - a registry ENTRY proves the founder merged it — which under the O3 merge chain
//     does start the build — but not that the build and provision succeeded.
//
// So the only evidence that the app is serving is asking it. `probeTenantHealthy`
// (lib/tenant-health.ts) does, and everything below it degrades to a weaker, honest
// claim.
//
// This file is PURE — no network, no DB — so the precedence above is unit-testable and
// sits inside the coverage floor, the same split `billing-display.ts` keeps from
// `billing.ts`. The probe lives next door.

export type TenantStage =
  /** Not paid yet — the pay button / activating panel owns this moment, say nothing. */
  | "none"
  /** Paid, nothing proposed yet. */
  | "preparing"
  /** A registry proposal is open, awaiting the founder's merge. */
  | "settingUp"
  /** In the registry, but the app has not answered. NEVER claim ready from here. */
  | "almostReady"
  /** Observed serving. The only stage that hands out a link. */
  | "ready";

export interface TenantStageFacts {
  /** A `first` payment has settled. */
  readonly paid: boolean;
  /** `TenantBilling.provisioningPrUrl` — the proposal was opened. */
  readonly provisioningPrUrl: string | null;
  /** The tenant's registry `domain`, or null when it has no entry *or the registry
   *  could not be read at all*. Both collapse to "no evidence", deliberately. */
  readonly registryDomain: string | null;
  /** `probeTenantHealthy` said yes. */
  readonly healthy: boolean;
}

/**
 * Which claim the evidence supports. First match wins, strongest evidence first.
 *
 * Every fall-through is a WEAKER claim, never a stronger one: an unreadable registry,
 * a timed-out probe and a tenant that genuinely is not built yet all land somewhere
 * that promises nothing. Under-claiming shows a live owner "almost ready" for up to a
 * minute; over-claiming sends a customer to a dead link and makes the product look
 * broken on the first thing they were ever told to do.
 *
 * `healthy` is guarded by `registryDomain` even though a caller can only obtain one by
 * probing the other — so the function is total, and a future caller that keeps a stale
 * `healthy` around cannot resurrect "ready" for a tenant with no entry.
 */
export function tenantStage(facts: TenantStageFacts): TenantStage {
  if (!facts.paid) return "none";
  if (facts.registryDomain && facts.healthy) return "ready";
  if (facts.registryDomain) return "almostReady";
  if (facts.provisioningPrUrl) return "settingUp";
  return "preparing";
}

/**
 * Which stage to actually SHOW, given what the plan status is already saying.
 *
 * In the mandate-lag window (`planState` "processing") `<ActivatingPanel />` is on
 * screen spelling out the whole wait — paid, bank confirming, then your app is
 * prepared. "We are preparing your app" underneath it is the same sentence twice, and
 * the argument the old `liveSinceLine` made still holds: a line that restates the line
 * above it is worse than no line.
 *
 * `almostReady` and `ready` survive that window, because they are NEW information —
 * the app exists now, which `ActivatingPanel` cannot know and does not claim.
 */
export function visibleTenantStage(stage: TenantStage, planIsProcessing: boolean): TenantStage {
  if (!planIsProcessing) return stage;
  return stage === "preparing" || stage === "settingUp" ? "none" : stage;
}

/**
 * `https://<domain>` for a registry domain, or null if the value is not a bare host.
 *
 * The registry is founder-reviewed YAML, so this is not the security boundary — but
 * the domain ORIGINATES as a customer-typed `desiredSlug`, and the panel turns it into
 * a link the owner is told to click and a request this server makes. Rejecting
 * anything carrying a scheme, credentials, port, path or query keeps a malformed entry
 * from aiming either one somewhere unintended.
 *
 * The final label must be alphabetic, which is what rules out an IP literal —
 * `127.0.0.1` is otherwise a well-formed sequence of dot-separated alphanumeric labels
 * and would sail through, pointing a server-side fetch at the loopback interface of
 * the container. Single-label names (`localhost`, `backend`) are refused by the same
 * rule needing at least one dot.
 */
export function tenantOrigin(domain: string): string | null {
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return null;
  return `https://${domain}`;
}

/** Where the owner sets their own admin password — the O3 page, on their own app. */
export function tenantForgotPasswordUrl(domain: string): string | null {
  const origin = tenantOrigin(domain);
  return origin ? `${origin}/forgot-password` : null;
}
