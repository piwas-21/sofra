// Pure registry-entry generation for the ADR-012 git-native provisioning trigger.
// The control plane computes a NEW tenants/registry.yml entry from tenant data and
// opens a PR to the deploy repo (lib/provisioning.ts). The registry stays the
// source of truth (ADR-003/007) — the entry is proposed as a reviewable PR, never
// written to the box directly. This module holds only the pure YAML-block builder
// so it stays unit-testable + free of the GitHub API / secrets.

import { stringify } from "yaml";
import type { ModuleId } from "./module-catalog";

/**
 * Modules `provision-tenant.sh` refuses unless the SAME entry also records a
 * `stripe_account:`. That guard `exit 1`s *before* the database, the compose project
 * and the image, so proposing the module without the account does not yield a tenant
 * lacking card payment — it yields no tenant at all.
 *
 * Hence the pairing rule below: the module ships only alongside an account, never on
 * its own. Which half is missing depends on the path in, and BOTH paths reach this one
 * generator:
 *
 * - **Self-serve.** The buyer has no `acct_` and cannot be given one — only the
 *   restaurant can create it, through Stripe's hosted onboarding, which cannot be
 *   pre-filled (`oauth_not_supported` on a Standard account, SOFRA-PAYMENTS-PLAN §3).
 *   So the module is deferred to a second registry PR and the PR body says so.
 * - **Founder.** `docs/runbooks/signup-to-live-tenant.md` §2b has the founder create
 *   the account BEFORE proposing, precisely because of this guard — so they arrive
 *   holding the `acct_`, and the entry carries both halves in one shot.
 *
 * Deferring unconditionally would have been wrong for the second path: it would make
 * the founder's documented order pointless and tell them, falsely, that no account can
 * exist yet.
 */
const ACCOUNT_PAIRED_MODULE_IDS: readonly ModuleId[] = ["online-payments"];

/**
 * Split a purchased module list into what this entry may carry now and what must wait
 * for a second registry PR. Pure and shared, so the entry and the PR body describing it
 * cannot disagree about which is which.
 *
 * `stripeAccount` is the whole hinge: with one, nothing is deferred; without one, the
 * account-paired ids are held back.
 */
export function splitDeferredModules(
  modules: string[],
  stripeAccount?: string,
): { granted: string[]; deferred: string[] } {
  // Whitespace-only is not an account: `provision-tenant.sh` tests `-z`, which a blank
  // string passes and " " does not — so a stray space would sail past the guard here and
  // then fail on the box, which is the one place this must never be discovered.
  if (stripeAccount?.trim()) return { granted: modules, deferred: [] };
  const isPaired = (id: string) => (ACCOUNT_PAIRED_MODULE_IDS as readonly string[]).includes(id);
  return {
    granted: modules.filter((id) => !isPaired(id)),
    deferred: modules.filter(isPaired),
  };
}

export interface TenantProvisionInput {
  /** Registry key + derivation seed. Must already match the slug grammar. */
  slug: string;
  name: string;
  adminEmail: string;
  template: "classic" | "craft";
  currency: string;
  languages: string[];
  modules: string[];
  /** The tenant's Stripe connected account (`acct_…`), when they already have one.
   *  Absent on the self-serve path; present when the founder followed runbook §2b. */
  stripeAccount?: string;
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
export function buildTenantRegistryEntry(input: TenantProvisionInput): {
  entry: string;
  deferred: string[];
} {
  const { slug } = input;
  const box = input.box ?? "staging";
  const stripeAccount = input.stripeAccount?.trim();
  const { granted, deferred } = splitDeferredModules(input.modules, stripeAccount);
  const entry = {
    [slug]: {
      name: input.name,
      status: "provisioning",
      managed: "scripts",
      box,
      domain: `${slug}.sofrapiwas.com`,
      domain_mode: "subdomain",
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
      // NOT `input.modules` — see ACCOUNT_PAIRED_MODULE_IDS.
      modules: granted,
      template: input.template,
      admin_email: input.adminEmail,
      // Emitted only when there is one, and always together with the module that needs
      // it — the two are written from the same `granted`/`stripeAccount` pair so the
      // entry can never carry one half of the guard's condition.
      ...(stripeAccount ? { stripe_account: stripeAccount } : {}),
      // Only emit city when set — the registry field is optional.
      ...(input.city ? { city: input.city } : {}),
    },
  };
  const block = stringify(entry)
    .trimEnd()
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
  return { entry: block, deferred };
}
