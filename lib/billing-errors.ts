// Typed failures of the onboarding/billing write path. Separate from
// billing-onboarding.ts so a caller can catch them without importing the
// Prisma + Mollie machinery, and so the three cases read as one list.

/** No PENDING plan to pay for (already active, canceled, or never defined). */
export class NoPendingPlanError extends Error {
  constructor() {
    super("no pending plan to start a payment for");
    this.name = "NoPendingPlanError";
  }
}

/** A first payment already succeeded; the plan is awaiting mandate validation +
 *  activation, NOT a new charge. Surfaced to the payer as "processing" —
 *  charging again here is the double-charge trap. */
export class FirstPaymentPaidError extends Error {
  constructor() {
    super("first payment already paid — plan is awaiting activation");
    this.name = "FirstPaymentPaidError";
  }
}

/** A plan was asked for with both payer references or neither — a programming
 *  error in an admin-only path, never user input, so it throws rather than
 *  returning a friendly message that would hide the bug. */
export class InvalidPayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayerError";
  }
}
