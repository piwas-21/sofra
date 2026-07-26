// How long a Mollie hosted-checkout URL is worth re-handing out.
//
// Pure and separate so the rule is unit-testable without importing the Prisma/
// Mollie side of billing-onboarding.ts, and so the number sits somewhere a
// reader can find it rather than inline in a `.find()` predicate.

/** Mollie expires hosted-checkout URLs around 60 minutes; 50 leaves the payer
 *  room to actually finish rather than landing on an expired-payment page. */
export const CHECKOUT_REUSE_WINDOW_MS = 50 * 60 * 1000;

/** Is a checkout created at `createdAt` still worth reusing? A future timestamp
 *  (app/database clock skew) counts as fresh — a just-created checkout must
 *  never read as stale. */
export function isCheckoutFresh(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() < CHECKOUT_REUSE_WINDOW_MS;
}
