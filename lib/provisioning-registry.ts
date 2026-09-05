// Pure registry-entry generation for the ADR-012 git-native provisioning trigger.
// The control plane computes a NEW tenants/registry.yml entry from tenant data and
// opens a PR to the deploy repo (lib/provisioning.ts). The registry stays the
// source of truth (ADR-003/007) — the entry is proposed as a reviewable PR, never
// written to the box directly. This module holds only the pure YAML-block builder
// so it stays unit-testable + free of the GitHub API / secrets.

import { stringify } from "yaml";
import { tenantHostname } from "./base-domain";
// The account-pairing rule (which fields must travel with a Stripe connected
// account) moved to its own file when a second paired field pushed this one
// over CLAUDE.md §4's LOC limit (SOFRA-PAYMENTS-PRICING-MODE-PLAN S1). Both are
// used here AND re-exported, so no existing importer of `splitDeferredModules`
// from this module had to change.
import { grantedCommissionBps, splitDeferredModules } from "./provisioning-module-pairing";

export { splitDeferredModules } from "./provisioning-module-pairing";

/** The zone every tenant lived under until D1. An absent `base_domain:` means exactly
 *  this, both here and in `provision-tenant.sh`. */
const DEFAULT_BASE_DOMAIN = "sofrapiwas.com";

export interface TenantProvisionInput {
  /** Registry key + derivation seed. Must already match the slug grammar. */
  slug: string;
  /**
   * A PARTNER'S OWN verified base domain, when the tenant should live under it rather
   * than under ours (SOFRA-PARTNER-FLEXIBILITY-PLAN D1) — `obresse.solutioneva.com`.
   *
   * Optional, and ABSENCE IS THE CONTRACT: without it the generator emits exactly what
   * it emitted before this field existed, `<slug>.sofrapiwas.com` with no `base_domain:`
   * key at all. That is what every entry in the registry looks like today, and the
   * deploy repo reads an absent `base_domain` as `sofrapiwas.com` for the same reason.
   * The regression proof is that every pre-existing test of this function passes
   * unchanged.
   */
  baseDomain?: string;
  name: string;
  adminEmail: string;
  template: "classic" | "craft";
  currency: string;
  languages: string[];
  modules: string[];
  /**
   * The tenant's Stripe connected account (`acct_…`) — SERVER-DERIVED since the
   * ADR-011 amendment: the control plane mints it (lib/provisioning-mint.ts) before
   * this entry is composed, on BOTH paths, so it is no longer something anyone types.
   * Absent only when the mint could not happen, which `stripeAccountNote` explains.
   */
  stripeAccount?: string;
  /**
   * The tenant's own onboarding page (`https://…/onboarding/payments/<token>`),
   * server-derived exactly like `stripeAccount` and emitted BESIDE it. It becomes
   * the tenant's `Stripe:PaymentsLinkUrl`, i.e. the button in their own Payments
   * tab. One opaque field: `provision-tenant.sh` copies it and never learns that
   * part of it is a credential, and no per-environment concatenation can put a
   * working link in front of the wrong site.
   */
  paymentsLinkUrl?: string;
  /**
   * Why there is no `stripeAccount`, in founder-facing words. NOT a registry field —
   * `buildTenantRegistryEntry` ignores it entirely; it exists so the PR body can say
   * what went wrong at the one moment someone is reading the diff. Absent when an
   * account was minted, and when none was needed.
   */
  stripeAccountNote?: string;
  /**
   * The tenant's per-transaction commission rate, in basis points
   * (SOFRA-PAYMENTS-PRICING-MODE-PLAN S1; range governed by `lib/payments-pricing.ts`,
   * not re-validated here). Whether it is actually WRITTEN into the entry is decided
   * by `grantedCommissionBps` (`./provisioning-module-pairing`) — absent or `0` is
   * the same statement `stripeAccount` above makes: every entry emitted before this
   * field existed, and every tenant alive today, is `flat`/0.
   */
  paymentsCommissionBps?: number;
  /**
   * The reseller credit this tenant's footer may carry (§11e) — and it is typed as
   * the OUTPUT of `renderableBrand`, not as a partner id or a brand row, on purpose.
   * That choke point is where `publishToTenants` and the D-B1a legal-name refusal
   * are decided, so a caller cannot reach this field without having passed them:
   * the only way to obtain a value of this shape is to have been allowed one.
   *
   * Optional, and ABSENCE IS THE CONTRACT, exactly as `baseDomain` above: without it
   * the generator emits precisely what it emitted before this field existed — no
   * `partner_name:`, no `partner_url:` — which is every entry in the registry today.
   * The proof is that every pre-existing test of this function passes unchanged.
   */
  partnerBrand?: { displayName: string; websiteUrl?: string };
  city?: string;
  /** Which box the tenant belongs on; provision-tenant.sh refuses a mismatch. */
  box?: string;
}

/**
 * Build the `tenants/registry.yml` entry for a NEW tenant as a YAML block already
 * indented two spaces so it nests under `tenants:`. Slug-derived fields
 * (`db`/`db_role`/`compose_project`/`domain`/`frontend_tag`) follow the registry
 * conventions; `status` starts at `provisioning` and `managed` is `scripts` (never
 * `legacy` — that guard protects tenant 1, ADR-006). String values are emitted via
 * `yaml.stringify`, so any special characters in name/city are safely escaped (no
 * YAML injection from free-text input).
 *
 * Returns the modules it had to DEFER alongside the block, rather than only the block:
 * a caller that proposes this entry without saying what was stripped has silently sold
 * a module and shipped an entry omitting it. Making the strip part of the return value
 * is what stops the next caller doing that by omission.
 */
/**
 * The hostname an entry will answer on.
 *
 * Exported because the PR body has to quote the SAME name the entry carries — a body
 * that says `slug.sofrapiwas.com` above a diff that says `slug.solutioneva.com` is worse
 * than no body, because the founder ticks the checklist against it.
 */
export function tenantDomain(input: Pick<TenantProvisionInput, "slug" | "baseDomain">): string {
  return tenantHostname(input.slug, input.baseDomain || DEFAULT_BASE_DOMAIN);
}

export function buildTenantRegistryEntry(input: TenantProvisionInput): {
  entry: string;
  deferred: string[];
} {
  const { slug } = input;
  const box = input.box ?? "staging";
  const stripeAccount = input.stripeAccount?.trim();
  const { granted, deferred } = splitDeferredModules(input.modules, stripeAccount);
  const commissionBps = grantedCommissionBps(input.paymentsCommissionBps, granted);
  const entry = {
    [slug]: {
      name: input.name,
      status: "provisioning",
      managed: "scripts",
      box,
      domain: tenantDomain(input),
      domain_mode: "subdomain",
      // Emitted ONLY when the tenant lives under a partner's zone. An always-present
      // `base_domain: sofrapiwas.com` would be a no-op key on every existing entry and
      // a diff on every future one; absent is the same statement and is what the script
      // already defaults to.
      ...(input.baseDomain ? { base_domain: input.baseDomain } : {}),
      db: `tenant_${slug}`,
      db_role: `tenant_${slug}`,
      compose_project: `tenant-${slug}`,
      // Always `:latest` — released code, published only from `main`. NOT derived from
      // `box` (as it was until 2026-07-31): every self-serve tenant lands on
      // `box: staging`, because that is where the control plane runs, so deriving from
      // the box silently gave every paying customer the develop build — and, because the
      // staging box's deploy re-pulls `:staging` tenants on every backend develop merge,
      // applied develop's EF migrations to their database each time.
      //
      // A develop-tracking SHOWCASE (`demo`) still wants `:staging`, but that is a
      // founder judgement about one tenant, not something the generator can infer — so it
      // is a hand-edit to this field in the proposed PR, which is exactly the review
      // checkpoint ADR-012 puts at the merge. The PR body says so.
      backend_tag: "latest",
      frontend_tag: `tenant-${slug}`,
      currency: input.currency,
      languages: input.languages,
      // NOT `input.modules` — see splitDeferredModules (./provisioning-module-pairing).
      modules: granted,
      template: input.template,
      admin_email: input.adminEmail,
      // Emitted only when there is one, and always together with the module that needs
      // it — the two are written from the same `granted`/`stripeAccount` pair so the
      // entry can never carry one half of the guard's condition.
      ...(stripeAccount ? { stripe_account: stripeAccount } : {}),
      // Emitted only ALONGSIDE the account, never on its own: without an account
      // there is no onboarding page to point at, and a link to a page that 404s is
      // worse than no button at all. Same pairing discipline as the two fields
      // above, one field along.
      ...(stripeAccount && input.paymentsLinkUrl ? { payments_link_url: input.paymentsLinkUrl } : {}),
      // Whether the rate belongs in THIS entry: grantedCommissionBps (same pairing
      // rule as stripe_account above, applied to a second field).
      ...(commissionBps !== undefined ? { payments_commission_bps: commissionBps } : {}),
      // Only emit city when set — the registry field is optional.
      ...(input.city ? { city: input.city } : {}),
      // The partner credit, emitted only when there is a publishable one. NOT
      // `partner_attribution:` — absent means true (D-B2), so writing it on every
      // entry would be a no-op line on all of them and a diff on all of them. It is
      // the RESTAURANT's switch, hand-added on their behalf when they ask for it, and
      // resolved in `provision-tenant.sh` so the tenant env carries one meaning only.
      ...(input.partnerBrand
        ? {
            partner_name: input.partnerBrand.displayName,
            ...(input.partnerBrand.websiteUrl ? { partner_url: input.partnerBrand.websiteUrl } : {}),
          }
        : {}),
    },
  };
  const block = stringify(entry)
    .trimEnd()
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
  return { entry: block, deferred };
}
