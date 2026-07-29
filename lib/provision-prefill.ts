// Provisioning-form defaults carried over from a signup lead
// (SOFRA-ONBOARDING-PLAN O1), so the founder edits an answer sheet instead of
// retyping every product choice the customer already made.
//
// The sibling of lib/onboard-tenants.ts's `toOnboardPrefill`: same shape of job,
// different form. That one fills the BILLING side (who pays, how much); this one
// fills the REGISTRY side (what gets provisioned).
//
// Pure — no DB, no network — so the mapping stays unit-testable.

import { isModuleId, type ModuleId } from "./module-catalog";
import {
  isTemplateId,
  isTenantCurrency,
  isTenantLanguage,
  parseCsv,
  type TemplateId,
  type TenantCurrency,
  type TenantLanguage,
} from "./tenant-options";

/**
 * Defaults for the provisioning form.
 *
 * The string fields are always present ("" when the lead didn't supply one)
 * because they map to text inputs. The choice fields are OPTIONAL on purpose:
 * `undefined` means "this lead never said", and the form must then keep its own
 * default rather than have one invented here. Leads captured before the
 * configurator shipped have no product choices at all, and a prefill that
 * silently answered for them would put words in the customer's mouth — the exact
 * failure the signup sanitizer avoids with its NOTHING_CHOSEN case.
 */
export type ProvisionPrefill = {
  /** Rides a hidden field so a successful proposal can be traced to its lead. */
  signupId: string;
  /** Registry-grammar slug when the lead supplied one, else "" (optional at intake). */
  slug: string;
  name: string;
  adminEmail: string;
  city: string;
  template?: TemplateId;
  currency?: TenantCurrency;
  /** Validated module ids as the lead chose them; [] when they chose none. */
  modules: ModuleId[];
  /** Validated tenant locales; [] when the lead chose none. */
  languages: TenantLanguage[];
};

/** The signup fields the prefill reads — a structural subset of the Prisma row. */
export type SignupProvisionSource = {
  id: string;
  restaurantName: string;
  email: string;
  city: string | null;
  desiredSlug: string | null;
  modules: string | null;
  languages: string | null;
  template: string | null;
  currency: string | null;
};

/**
 * Build provisioning-form defaults from a signup lead.
 *
 * Everything is re-validated even though `sanitizeSignupConfiguration` already
 * validated it on the way in. That is not redundant: these rows are months old
 * by the time anyone provisions them, the catalog vocabulary can retire an id in
 * between, and a row can be edited straight in the DB. An unrecognised value is
 * DROPPED rather than carried, so the worst case is a founder ticking one box
 * again — not a registry entry that `provision-tenant.sh` rejects at the seam,
 * far from where it came from.
 *
 * The email is lower-cased here so the founder sees exactly the value the action
 * will send (`openProvisioningPrAction` lower-cases it anyway) rather than a
 * field that appears to change on submit.
 */
export function toProvisionPrefill(signup: SignupProvisionSource): ProvisionPrefill {
  const template = signup.template ?? "";
  const currency = signup.currency ?? "";

  return {
    signupId: signup.id,
    slug: signup.desiredSlug ?? "",
    // The registry's `name:` is the restaurant, not the contact — the contact
    // name belongs to the onboarding/billing side and is deliberately not read.
    name: signup.restaurantName,
    adminEmail: signup.email.toLowerCase(),
    city: signup.city ?? "",
    template: isTemplateId(template) ? template : undefined,
    currency: isTenantCurrency(currency) ? currency : undefined,
    modules: parseCsv(signup.modules).filter(isModuleId),
    languages: parseCsv(signup.languages).filter(isTenantLanguage),
  };
}
