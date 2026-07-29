// Normalise the public configurator's answers before they are stored
// (SOFRA-ONBOARDING-PLAN O1).
//
// Everything here arrives from an anonymous POST, so nothing is trusted. Two
// rules shape the whole module:
//
//  1. DROP, don't reject. A lead is a sales opportunity; losing one because a
//     cached bundle sent a module id we retired would be a bad trade. Unknown
//     values are discarded and the rest of the signup is kept. The vocabulary is
//     re-validated at /admin/provision and AGAIN by provision-tenant.sh, where a
//     bad value is a loud failure rather than a silent tenant misconfiguration.
//  2. RE-QUOTE, never trust. The posted price is ignored entirely; the total is
//     recomputed from the catalog so a crafted POST cannot make the founder read
//     a number the lead was never actually shown.
//
// Pure — no DB, no network — so it is unit-testable on its own.

import { extraLanguageCount, isModuleId, quoteModules, type ModuleId } from "./module-catalog";
import {
  isTemplateId,
  isTenantCurrency,
  isTenantLanguage,
  parseCsv,
  TEMPLATES,
  TENANT_CURRENCIES,
} from "./tenant-options";

/** Raw configurator fields as they come off the wire (all optional). */
export type RawSignupConfiguration = {
  modules?: string;
  languages?: string;
  template?: string;
  currency?: string;
};

/** What gets written to SignupRequest — CSV in the registry grammar, or null. */
export type StoredSignupConfiguration = {
  modules: string | null;
  languages: string | null;
  template: string | null;
  currency: string | null;
  quotedCents: number | null;
};

/** Set when the lead chose nothing at all, so the founder still decides. */
const NOTHING_CHOSEN: StoredSignupConfiguration = {
  modules: null,
  languages: null,
  template: null,
  currency: null,
  quotedCents: null,
};

export function sanitizeSignupConfiguration(
  raw: RawSignupConfiguration,
): StoredSignupConfiguration {
  const languages = parseCsv(raw.languages).filter(isTenantLanguage);
  const modules = parseCsv(raw.modules).filter(isModuleId);

  // A submission with no recognisable choices is treated as no configuration at
  // all rather than as "core only" — the two mean different things to a founder
  // reading the queue, and guessing would put words in the lead's mouth.
  if (languages.length === 0 && modules.length === 0 && !raw.template && !raw.currency) {
    return NOTHING_CHOSEN;
  }

  // English always ships (the tenant app's fallback locale), and it leads the
  // list so the registry entry reads `en, …` the way the script's examples do.
  const withEnglish: string[] = ["en", ...languages.filter((l) => l !== "en")];

  // Core is implicit in pricing and mandatory in the registry, so state it.
  const withCore: ModuleId[] = ["core", ...modules.filter((m) => m !== "core")];

  // Keep the billed module list and the language count consistent: if the
  // selection is charged for extra languages it must also RECORD the add-on, or
  // the tenant pays for a module their instance was never marked as having.
  const needsExtra = extraLanguageCount(withEnglish) > 0;
  const finalModules: ModuleId[] = needsExtra
    ? [...withCore.filter((m) => m !== "extra-languages"), "extra-languages"]
    : withCore.filter((m) => m !== "extra-languages");

  return {
    modules: finalModules.join(","),
    languages: withEnglish.join(","),
    // Fall back to the first listed option rather than storing an invalid value
    // that would fail provisioning much later, far from its cause.
    template: raw.template && isTemplateId(raw.template) ? raw.template : TEMPLATES[0].id,
    currency:
      raw.currency && isTenantCurrency(raw.currency) ? raw.currency : TENANT_CURRENCIES[0],
    // Recomputed, never the posted value.
    quotedCents: quoteModules(finalModules).monthlyCents,
  };
}
