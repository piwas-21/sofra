// Payment-triggered provisioning (SOFRA-ONBOARDING-PLAN O3, second half) — the shell.
//
// When a SELF-SERVE tenant's first payment settles, propose its registry entry without
// waiting for the founder to open /admin/provision. The founder still reviews and merges
// — the human checkpoint, and under the merge chain the merge is what stands the tenant
// up — so this automates the typing, not the judgement.
//
// The decision lives in lib/auto-provision-policy.ts (pure, unit-tested). This file only
// gathers facts, performs the side effects the policy authorises, and translates
// GitHub's refusals. Two rules it must keep:
//  1. **It never throws.** Its caller is the Mollie webhook, where an exception means a
//     non-2xx — a paid customer's activation retried for ~26h. Failures become outcomes.
//  2. **The gate is still the authority.** `slugProvisionVerdict` runs here even though
//     the only caller reaches this from `first`+`paid`: a second path deciding for
//     itself when money counts is how the two drift apart (trap 7).

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { slugProvisionVerdict } from "@/lib/provisioning-facts";
import { toProvisionPrefill } from "@/lib/provision-prefill";
import { classifyProvisioningRefusal, decideAutoPropose, type AutoProposeOutcome } from "@/lib/auto-provision-policy";
import { reportFailedProposal } from "@/lib/billing-notify";
import {
  openProvisioningPr,
  provisioningConfigured,
  ProvisioningApiError,
  ProvisioningNotConfiguredError,
} from "@/lib/provisioning";

export { AUTO_PROPOSE_NOTES, type AutoProposeOutcome, type AutoProposeSkip } from "@/lib/auto-provision-policy";

/**
 * Try to open the registry PR for this billing row. Safe to call repeatedly — that is the
 * ordinary case, since Mollie redelivers webhooks.
 *
 * Idempotency is `provisioningPrUrl` on our own row, read by the policy and written here.
 * GitHub refusing a duplicate `provision/<slug>` branch is the backstop, not the
 * mechanism: two concurrent deliveries can both read null, and the loser is recognised
 * rather than reported as a failure. (The MINT has its own, separate idempotency — a
 * slug-derived Stripe key plus a unique row; see lib/connect-account-store.ts.)
 */
export async function autoProposeProvisioning(billingId: string): Promise<AutoProposeOutcome> {
  try {
    const billing = await db.tenantBilling.findUnique({
      where: { id: billingId },
      include: { signupRequest: true },
    });
    // Only reachable if the row vanished between recordPayment's read and this one. A
    // `skipped` here would email the founder a confident falsehood about a dead plan.
    if (!billing) return { kind: "failed", detail: `billing row ${billingId} disappeared mid-delivery` };

    // Re-validates every stored answer and DROPS whatever the catalog no longer
    // recognises, so a months-old lead cannot carry a retired module id to the box.
    const lead = billing.signupRequest ? toProvisionPrefill(billing.signupRequest) : null;

    const plan = decideAutoPropose({
      existingPrUrl: billing.provisioningPrUrl,
      config: lead
        ? { ...lead, billingSlug: billing.tenantSlug }
        : null,
      // Only asked when it can matter — the gate is a query.
      settled: lead ? (await slugProvisionVerdict(billing.tenantSlug)) === "allowed" : false,
      provisioningConfigured: provisioningConfigured(),
    });
    if (plan.kind !== "propose") return finish(billing.tenantSlug, plan);

    // Non-null by the policy's own checks; asserted so a future policy edit that drops a
    // guard fails here loudly instead of proposing a tenant with no theme.
    if (!lead?.template || !lead.currency) {
      return finish(billing.tenantSlug, {
        kind: "failed",
        detail: "policy authorised an incomplete configuration",
      });
    }

    const { prUrl, deferred, mintNote } = await openProvisioningPr({
      slug: billing.tenantSlug,
      name: lead.name,
      adminEmail: lead.adminEmail,
      template: lead.template,
      currency: lead.currency,
      languages: lead.languages,
      modules: lead.modules,
      // Still no `stripeAccount` here, for the OPPOSITE reason to before: it is minted
      // inside `openProvisioningPr` (ADR-011 amendment, E3) — the single place that
      // writes an entry — so neither caller can forget it or invent one.
      city: lead.city || undefined,
    });
    await db.tenantBilling.update({
      where: { id: billing.id },
      data: { provisioningPrUrl: prUrl },
    });
    return finish(billing.tenantSlug, {
      kind: "opened",
      prUrl,
      ...(deferred.length ? { deferred } : {}),
      // Only when the mint failed — "we could not create this paying customer's Stripe
      // account" must be answerable from our own rows, not only from a PR body.
      ...(mintNote ? { mintNote } : {}),
    });
  } catch (e) {
    return finish(slugFor(billingId), await translate(billingId, e));
  }
}

/** Best-effort slug for the failure path, where the row read may itself have failed. */
async function slugFor(billingId: string): Promise<string> {
  try {
    const b = await db.tenantBilling.findUnique({
      where: { id: billingId },
      select: { tenantSlug: true },
    });
    return b?.tenantSlug ?? billingId;
  } catch {
    return billingId;
  }
}

/**
 * Turn a thrown error into an outcome. The subtle case is `proposalOpen`: the branch
 * exists, which is *usually* a concurrent delivery whose winner has by now recorded the
 * PR URL — but `openProvisioningPr` creates the branch before it opens the PR, so an
 * attempt that died in between leaves an orphan branch and no PR. Reporting that as a
 * benign duplicate is a permanent wedge: every retry would say "already exists, nothing
 * to do" while a paid customer has no tenant. So re-read the row, and only call it a
 * duplicate if a URL was actually recorded.
 */
async function translate(billingId: string, e: unknown): Promise<AutoProposeOutcome> {
  if (e instanceof ProvisioningNotConfiguredError) {
    return { kind: "failed", detail: "PROVISION_GITHUB_TOKEN is unset or expired" };
  }
  if (e instanceof ProvisioningApiError) {
    switch (classifyProvisioningRefusal(e.message)) {
      case "slugLive":
        return {
          kind: "failed",
          detail:
            "this slug is already a live tenant in the registry — a payment was taken for a subdomain that is not available. Needs a human.",
        };
      case "proposalOpen": {
        const recorded = await db.tenantBilling
          .findUnique({ where: { id: billingId }, select: { provisioningPrUrl: true } })
          .catch(() => null);
        if (recorded?.provisioningPrUrl) {
          return { kind: "alreadyProposed", prUrl: recorded.provisioningPrUrl };
        }
        return {
          kind: "failed",
          detail:
            "a provision/<slug> branch exists but no PR is recorded — an earlier attempt probably died between creating the branch and opening the PR. Delete the orphan branch on the deploy repo, then retry.",
        };
      }
      default:
        return { kind: "failed", detail: e.message };
    }
  }
  // Never rethrow: see rule 1 in the header.
  console.error("autoProposeProvisioning failed", billingId, e);
  return { kind: "failed", detail: "unexpected error — see the control-plane logs" };
}

/**
 * Record every outcome, and email the founder about a failure immediately.
 *
 * Both halves exist because the payment email is NOT a reliable carrier for this: it is
 * sent after `activatePendingSubscriptions`, which deliberately throws to force a webhook
 * 503 during the mandate race. A silently expired token plus a lagging mandate would
 * otherwise be reported nowhere at all — the exact trap the policy makes loud.
 */
async function finish(
  slugOrPromise: string | Promise<string>,
  outcome: AutoProposeOutcome,
): Promise<AutoProposeOutcome> {
  // Fully guarded: this also runs from inside the catch block, so a throw here would
  // escape the module and break rule 1 — and it would do so while reporting a failure,
  // i.e. at the worst possible moment.
  try {
    const slug = await slugOrPromise;
    // actor null: this was a payment, not a person.
    await audit(null, `tenant.provision.auto.${outcome.kind}`, "Tenant", slug, {
      ...("prUrl" in outcome ? { prUrl: outcome.prUrl } : {}),
      ...("deferred" in outcome && outcome.deferred?.length ? { deferred: outcome.deferred } : {}),
      ...("mintNote" in outcome && outcome.mintNote ? { mintNote: outcome.mintNote } : {}),
      ...("reason" in outcome ? { reason: outcome.reason } : {}),
      ...("detail" in outcome ? { detail: outcome.detail } : {}),
    });
    if (outcome.kind === "failed") await reportFailedProposal(slug, outcome.detail);
  } catch (e) {
    console.error("autoProposeProvisioning: could not record outcome", e);
  }
  return outcome;
}
