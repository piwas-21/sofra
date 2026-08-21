// WHO gets told about money on a plan — one answer, used by every mail that
// discusses a bill.
//
// Extracted from `payment-receipt.ts` when the trial-ending warning needed the same
// resolution (T-d). Two copies of this would be two answers to "who is the
// customer", and the failure mode is not cosmetic: on a reseller plan the restaurant
// is NOT the customer, and mailing it about a charge it did not make leaks our
// wholesale price into the partner's own client relationship — the exact thing
// white-label resale sells against.

/** Whatever a `User` selection carries. `name` and `locale` optional so callers
 *  may omit them — a mail that only needs an address should not have to select
 *  three columns to type-check. */
type Named = { name?: string | null; email: string; locale?: string | null };

export type PayerContact = {
  /** `TenantBilling.email` — free text an admin typed; the last resort. */
  email: string;
  /** `TenantBilling.name` — the RESTAURANT, never a person. */
  name: string;
  billingIdentity?: { billingEmail: string } | null;
  /** Reseller plan: the payer is the partner (ADR-004 — `payerUserId` stays null). */
  client?: { partner: Named | null } | null;
  /** Direct-owner plan (ADR-004). */
  payer?: Named | null;
};

/**
 * The address to write to, preferring the one invoices already use
 * (`BillingIdentity.billingEmail`, `lib/invoicing.ts`) so a customer's receipt, their
 * invoice and a warning about their bill can never arrive at three addresses.
 */
export function payerAddress(billing: PayerContact): string | null {
  return (
    billing.billingIdentity?.billingEmail ??
    billing.client?.partner?.email ??
    // Last resort, and only for a plan with no identity and no payer reference at
    // all — a shape `defineTenantPlan` refuses to create today. The column is NOT
    // NULL, so there is no further fallback and no `?? null` below: the return type
    // stays nullable for the caller's benefit, not because this can return null.
    billing.payer?.email ??
    billing.email
  );
}

/**
 * The name to greet. Falls back to the restaurant, which writes "Hi Chez Amara," to
 * a person — clumsy, and still better than "Hi ," or an unaddressed mail. The
 * fallback is only reachable for a plan carrying neither a partner nor a payer.
 */
export function payerGreetingName(billing: PayerContact): string {
  return billing.client?.partner?.name || billing.payer?.name || billing.name;
}

/** Just enough of a plan to answer "in what language?" — deliberately narrower
 *  than `PayerContact`, so a caller that needs only the language selects only the
 *  language instead of pulling an address it does not use. */
export type PayerLocaleSource = {
  client?: { partner?: { locale?: string | null } | null } | null;
  payer?: { locale?: string | null } | null;
};

/**
 * The language to write in — resolved in the SAME order as the address (G9).
 *
 * That order is the point: on a reseller plan the person who reads the bill is the
 * PARTNER, so their language is the one the bill is written in, not the
 * restaurant's. Returns null when the plan carries no user at all (an admin-typed
 * `TenantBilling.email` and nothing else), which `emailLocale` turns into English —
 * a `BillingIdentity` records a country, and a country is not a language.
 */
export function payerLocale(billing: PayerLocaleSource): string | null {
  return billing.client?.partner?.locale ?? billing.payer?.locale ?? null;
}
