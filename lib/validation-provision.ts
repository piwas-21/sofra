// The founder's registry-entry proposal schema (ADR-012).
//
// Split out of `lib/validation.ts` when the pair outgrew one file's LOC limit
// (CLAUDE.md §4) — the same move `provisioning-pr-body.ts` made out of
// `provisioning-registry.ts`. This is the schema for ONE form, `/admin/provision`, and
// it is the one that carries the registry's own vocabulary (slug grammar, module ids,
// tenant locales, base domain); the rest of validation.ts is the public and partner
// forms.

import { z } from "zod";
import { normalizeBaseDomain } from "@/lib/base-domain";
import { MODULE_IDS, unknownModuleIds } from "@/lib/module-catalog";
import { TENANT_LANGUAGES, unknownLanguages } from "@/lib/tenant-options";
import { noControlChars, splitCsvLower } from "@/lib/validation";

// Propose a NEW tenant registry entry (ADR-012). languages/modules are comma-
// separated in the form; the action splits + lowercases them. Slug mirrors the
// registry grammar; currency is an ISO-4217 code.
export const provisionSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "lowercase slug, 2-31 chars"),
  name: noControlChars(z.string().trim().min(1).max(200)),
  adminEmail: z.string().trim().max(200).email(),
  template: z.enum(["classic", "craft"]),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "3-letter ISO code, e.g. EUR"),
  // Validated against the tenant-app locale set for the same reason `modules` is — and
  // since GAP-2 S9 a typo costs more than a missing UI language: this list becomes the
  // tenant's Localization__SupportedLanguages, the languages its MAIL is written in.
  // provision-tenant.sh refuses an unknown code, but on the box inside the unattended
  // ADR-012 merge chain. Self-serve was always safe (signup-configuration.ts filters
  // with isTenantLanguage); this closes the founder's own form.
  languages: z
    .string()
    .trim()
    .min(1)
    .refine((raw) => unknownLanguages(splitCsvLower(raw)).length === 0, {
      message: `unknown language — allowed: ${TENANT_LANGUAGES.map((l) => l.code).join(", ")}`,
    }),
  // Validated against the ADR-010 catalog, not just non-empty: a typo here is
  // silent — provision-tenant.sh writes whatever it is into the tenant env, and
  // the tenant simply never gets the module they are paying for.
  modules: z
    .string()
    .trim()
    .min(1)
    .refine((raw) => unknownModuleIds(splitCsvLower(raw)).length === 0, {
      message: `unknown module — allowed: ${MODULE_IDS.join(", ")}`,
    }),
  city: z.string().trim().max(200).optional().or(z.literal("")),
  // A PARTNER'S own zone, when the tenant should live under it rather than ours
  // (SOFRA-PARTNER-FLEXIBILITY-PLAN D1). Left empty, the generator emits exactly what
  // it emitted before this field existed — that is the whole contract, and every
  // pre-existing test of `buildTenantRegistryEntry` passing unchanged is its proof.
  //
  // Validated through `normalizeBaseDomain` rather than a second regex, so the founder's
  // form and the partner's claim cannot disagree about what a base domain is. It is a
  // GRAMMAR check and nothing more: the form only ever offers zones a partner has
  // proven (`allVerifiedBaseDomains`), and the founder — who is `requireAdmin()` and is
  // the person who merges the registry PR either way — is not somebody this schema is
  // defending against. The verification gate exists to stop a PARTNER asserting a zone.
  // The check that actually catches a founder's mistake is the PR-body pre-flight: the
  // A record has to resolve before the merge, or no certificate can be issued.
  baseDomain: z
    .string()
    .trim()
    .refine((v) => v === "" || normalizeBaseDomain(v).ok, "not a usable base domain")
    .optional()
    .or(z.literal("")),
});

/**
 * Does this string have the grammar of a Stripe connected-account id?
 *
 * It used to be a FIELD on the schema above, because the founder typed the value
 * by hand (runbook §2b had them create the account with `curl` first). Under the
 * ADR-011 amendment the control plane MINTS the account, so `stripeAccount` is
 * server-derived and no longer an operator input — the field is gone from the
 * form, from `readProvisionForm` and from this schema.
 *
 * The check itself stays, moved to where the value now comes from
 * (`lib/provisioning-mint.ts`, applied to what Stripe returned). The reason it
 * existed has not changed: this value reaches the tenant's Stripe env, where a
 * wrong string means charges addressed to an account that does not exist. What
 * changed is only who could get it wrong — and an assertion that has never fired
 * is exactly the kind worth keeping when the thing it guards is money.
 */
const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,32}$/;

export function isStripeAccountId(value: string): boolean {
  return STRIPE_ACCOUNT_ID.test(value);
}
