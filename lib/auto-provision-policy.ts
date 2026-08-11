// Should the payment-triggered registry proposal be opened, and if not, what should the
// founder be told? (SOFRA-ONBOARDING-PLAN O3, second half.)
//
// Pure — no DB, no network, no GitHub — for the same reason
// lib/provisioning-payment-gate.ts is: the policy is the part worth pinning in tests,
// and the repo forbids the mocks that testing it through Prisma and fetch would need
// (CLAUDE.md §7). lib/auto-provision.ts is the shell that feeds this and performs the
// one side effect it authorises.

/** Why an automatic proposal was not opened. None of these is an error. */
export type AutoProposeSkip =
  | "notSelfServe"
  | "awaitingPayment"
  | "incompleteConfiguration"
  | "slugMismatch"
  | "unsafeName"
  | "proposalExists";

/** The plan: either do the one side effect, or report without doing it. */
export type AutoProposePlan =
  | { kind: "propose" }
  | { kind: "alreadyProposed"; prUrl: string }
  | { kind: "skipped"; reason: AutoProposeSkip }
  | { kind: "failed"; detail: string };

export type AutoProposeOutcome =
  | Exclude<AutoProposePlan, { kind: "propose" }>
  // `deferred` = modules the buyer PAID for that the proposed entry withholds, because
  // provisioning refuses them without a Stripe account the self-serve buyer cannot have
  // yet. Carried on the outcome so it reaches the audit trail: this is the only durable
  // record that someone is being billed for a module their tenant does not yet have.
  | { kind: "opened"; prUrl: string; deferred?: string[] };

/** The already-validated configuration a lead recorded, plus the slug it must match. */
export type AutoProposeConfig = {
  /** The lead's requested slug, after re-validation. */
  slug: string;
  /** The slug this plan bills against — the immutable anchor. */
  billingSlug: string;
  /** Becomes the registry `name:`, and from there a Docker build arg. */
  name: string;
  template?: string;
  currency?: string;
  modules: string[];
  languages: string[];
};

export type AutoProposeFacts = {
  /** A proposal already recorded on this plan. */
  existingPrUrl: string | null;
  /** The configuration from the linked lead; null when there is no lead at all. */
  config: AutoProposeConfig | null;
  /** The O2 payment gate said this slug may be proposed. */
  settled: boolean;
  /** PROVISION_GITHUB_TOKEN is present. */
  provisioningConfigured: boolean;
};

/**
 * Order matters, and each position is a decision:
 *
 *  1. **Already proposed wins over everything.** Mollie redelivers webhooks, so this is
 *     the ordinary repeat case, not an edge one — and answering it first means a
 *     redelivery cannot be reported as a fresh skip or failure.
 *  2. **No lead ⇒ not self-serve.** The same signal the payment gate keys on
 *     (/admin/onboard, the reseller flow, and RUMI have no lead). Not our business to
 *     automate, and silence would be wrong: the founder should read why.
 *  3. **The gate outranks the configuration.** An unpaid plan is refused before we look
 *     at what it asked for, so a badly configured unpaid plan is reported as unpaid.
 *  4. **Slug mismatch is its own answer, not "incomplete".** If the lead's slug and the
 *     billing anchor disagree, something upstream is wrong; conflating it with a missing
 *     template would send the founder to fill in a form instead of investigating.
 *  5. **Missing configuration is a skip, never a guess.** Template and currency have no
 *     safe default for someone paying — the theme is baked into their image and the
 *     currency prices their menu.
 *  6. **A missing token is a FAILURE, not a skip.** PROVISION_GITHUB_TOKEN expires
 *     silently (trap 4); on this path nobody is looking at the "not configured" banner,
 *     so it has to be loud. Checked last so a plan that was never eligible does not
 *     raise a token alarm.
 */
export function decideAutoPropose(facts: AutoProposeFacts): AutoProposePlan {
  if (facts.existingPrUrl) return { kind: "alreadyProposed", prUrl: facts.existingPrUrl };
  if (!facts.config) return { kind: "skipped", reason: "notSelfServe" };
  if (!facts.settled) return { kind: "skipped", reason: "awaitingPayment" };

  const c = facts.config;
  if (c.slug !== c.billingSlug) return { kind: "skipped", reason: "slugMismatch" };
  if (!c.template || !c.currency || c.modules.length === 0 || c.languages.length === 0) {
    return { kind: "skipped", reason: "incompleteConfiguration" };
  }
  // Defence in depth behind `signupSchema`. That guard is new (O3), so rows captured
  // before it can still hold a newline — and this name travels into
  // build-tenant-image.yml's newline-delimited `build-args:`. The deploy chain rejects
  // it too, but only AFTER the entry is merged, which would leave a paying customer
  // with a merged registry entry that never provisions.
  if (/[\u0000-\u001f\u007f]/.test(c.name)) return { kind: "skipped", reason: "unsafeName" };
  if (!facts.provisioningConfigured) {
    return { kind: "failed", detail: "PROVISION_GITHUB_TOKEN is unset or expired" };
  }
  return { kind: "propose" };
}

/** Founder-facing one-liners. Deliberately say what to DO, not just what happened. */
export const AUTO_PROPOSE_NOTES: Record<AutoProposeSkip, string> = {
  notSelfServe:
    "No automatic proposal: this plan was created by hand (no signup lead attached), so provisioning stays manual as before.",
  awaitingPayment:
    "No automatic proposal: the payment gate does not consider this plan settled yet. Nothing to do — the next webhook delivery retries.",
  incompleteConfiguration:
    "No automatic proposal: the lead did not record a full configuration (template, currency, modules and languages are all required). Open /admin/provision?from=<signup id> and choose.",
  slugMismatch:
    "No automatic proposal: the lead's requested web address does not match the slug this plan bills against. Someone should look at that before a tenant is created.",
  unsafeName:
    "No automatic proposal: the restaurant name holds a line break or control character, which cannot go into a tenant image build. Fix the name on the lead, then open /admin/provision?from=<signup id>.",
  proposalExists:
    "No automatic proposal opened: a proposal for this slug already exists and is recorded. Nothing to do.",
};

/**
 * What `openProvisioningPr` meant by refusing. Pure, and here rather than in the shell,
 * because the first version of this lived in the shell as an untested string test and got
 * it wrong: it matched BOTH refusals and called them both "a proposal already exists".
 *
 *  - `slugLive`     — the slug is already MERGED into the registry, i.e. a live tenant.
 *                     Reported as a benign "already proposed" this becomes: money taken
 *                     for a subdomain that belongs to someone else, and an email saying
 *                     there is nothing to do.
 *  - `proposalOpen` — the `provision/<slug>` branch exists. Usually a concurrent webhook
 *                     delivery; but `openProvisioningPr` creates the branch BEFORE it
 *                     commits and opens the PR, so it is also what an interrupted attempt
 *                     leaves behind. The caller has to tell those apart by whether a PR
 *                     URL was actually recorded — an orphan branch with no PR is a wedge,
 *                     not a duplicate.
 */
export type ProvisioningRefusal = "slugLive" | "proposalOpen" | "other";

export function classifyProvisioningRefusal(message: string): ProvisioningRefusal {
  if (/already has/i.test(message)) return "slugLive";
  if (/already open/i.test(message)) return "proposalOpen";
  return "other";
}
