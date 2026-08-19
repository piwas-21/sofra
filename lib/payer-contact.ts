// WHO gets told about money on a plan — one answer, used by every mail that
// discusses a bill.
//
// Extracted from `payment-receipt.ts` when the trial-ending warning needed the same
// resolution (T-d). Two copies of this would be two answers to "who is the
// customer", and the failure mode is not cosmetic: on a reseller plan the restaurant
// is NOT the customer, and mailing it about a charge it did not make leaks our
// wholesale price into the partner's own client relationship — the exact thing
// white-label resale sells against.

/** Whatever a `User` selection carries. `name` optional so callers may omit it. */
type Named = { name?: string | null; email: string };

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
