// Tenant INSTANCE vocabulary — the non-priced choices a tenant is provisioned
// with: which languages it serves, which UI template it is built from, which
// currency it prices in (sofra ADR-006/ADR-007/ADR-010).
//
// Split out of module-catalog.ts, which answers a different question: that file
// is "what can you buy and what does it cost", this one is "how is the instance
// configured". Both feed tenants/registry.yml, and every value here must match
// provision-tenant.sh's allow-lists — the script fails loudly on anything it does
// not recognise, with no silent default.
//
// Pure by design — no DB, no network, no env — so it stays unit-testable and
// identical wherever it is used.

/**
 * Locales the TENANT app ships (frontend `src/i18n.ts` — 10 since the Dutch
 * addition, frontend #126). Not the same set as this control plane's six site
 * locales: a tenant can serve languages sofrapiwas.com does not.
 *
 * `en` is not optional — it is what the tenant app falls back to.
 */
export const TENANT_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "nl", label: "Nederlands" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
] as const;

export type TenantLanguage = (typeof TENANT_LANGUAGES)[number]["code"];

const LANGUAGE_CODES = new Set<string>(TENANT_LANGUAGES.map((l) => l.code));

export function isTenantLanguage(value: string): value is TenantLanguage {
  return LANGUAGE_CODES.has(value);
}

/** The ids in `values` that the tenant app cannot serve — empty means all valid. */
export function unknownLanguages(values: readonly string[]): string[] {
  return values.filter((v) => !isTenantLanguage(v));
}

/**
 * UI templates a tenant instance can be built with (frontend ADR-006 / S15 T2).
 * Written to the registry as `template:` and baked into the per-tenant image as
 * `NEXT_PUBLIC_TEMPLATE` — so this is a BUILD-TIME choice: changing it later
 * means rebuilding the tenant image, not flipping an env var.
 */
export const TEMPLATES = [
  { id: "classic", swatch: "#7C8450" },
  { id: "craft", swatch: "#A84B2F" },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];

const TEMPLATE_IDS = new Set<string>(TEMPLATES.map((t) => t.id));

export function isTemplateId(value: string): value is TemplateId {
  return TEMPLATE_IDS.has(value);
}

/** Currencies a tenant instance can price in. */
export const TENANT_CURRENCIES = ["EUR", "CHF"] as const;

export type TenantCurrency = (typeof TENANT_CURRENCIES)[number];

export function isTenantCurrency(value: string): value is TenantCurrency {
  return (TENANT_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Parse one of the comma-separated lists the registry grammar uses, dropping
 * blanks and duplicates while preserving order.
 *
 * Lives here because BOTH ends of the funnel need it — the public configurator
 * writes CSV onto SignupRequest, and the admin side reads it back to prefill
 * provisioning.
 */
export function parseCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((v) => v.trim()).filter(Boolean))];
}
