// What language do we write to this person in?
//
// Every company mail was hardcoded English until this module (EMAIL-SPEC-CONTROL-PLANE
// §1: *"the control plane has a locale resolver and both intakes persist the visitor's
// locale — no email reads either"*). A warning about money, sent in a language the
// reader did not choose, is the one place that gap actually costs something.
//
// It is NOT `controlLocale()`: that reads the NEXT_LOCALE cookie, and a cron has no
// cookies and no request. What the control plane durably HOLDS about a person is the
// locale their intake was captured in — `PartnerApplication.locale` for a partner,
// `SignupRequest.locale` for a self-serve owner — so that is what is read here.

import { createTranslator, hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

/** Values a mail may interpolate. Pre-escaped by the caller when they reach HTML. */
export type EmailValues = Record<string, string | number | Date>;
export type EmailTranslator = (key: string, values?: EmailValues) => string;

/**
 * The first candidate that is a locale we actually ship, else the default.
 *
 * Total by construction: a row holding `"de-CH"`, `""` or a locale we dropped falls
 * through to English rather than rendering raw message keys at a customer.
 */
export function emailLocale(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    if (c && hasLocale(routing.locales, c)) return c;
  }
  return routing.defaultLocale;
}

/**
 * A translator for one namespace of one locale, with no request in scope.
 *
 * `createTranslator` rather than `getTranslations()` on purpose: the latter resolves
 * through `i18n/request.ts` and belongs to a request, and this runs in a sweep that
 * mails several people in several languages in one pass. The import mirrors
 * `i18n/request.ts` so both read from the same message files and the same parity gate
 * (`scripts/check-message-parity.mjs`) covers both.
 */
export async function emailTranslator(
  locale: string,
  namespace: string,
): Promise<EmailTranslator> {
  const safe = emailLocale(locale);
  const messages = (await import(`../messages/${safe}.json`)).default;
  const t = createTranslator({ locale: safe, messages, namespace });
  return (key, values) => t(key as never, values as never);
}
