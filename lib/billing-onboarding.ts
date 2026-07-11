// Partner-onboarding billing (SOFRA-PARTNER-PLAN, reseller flow). Two steps
// that split the admin-only createTenantBilling (lib/billing.ts) so a plan can
// be defined before the payer pays:
//
//   1. defineTenantPlan  — admin defines a PENDING plan for a tenant. NO Mollie
//      call: the TenantBilling is created with a null mollieCustomerId.
//   2. startFirstPayment — the payer (partner) triggers the first payment. The
//      Mollie customer is created on demand, then a first-payment hosted
//      checkout; the URL is returned for the browser to redirect to.
//
// The recurring subscription is then activated by the SAME unsigned webhook +
// activatePendingSubscriptions path in lib/billing.ts — untouched here.

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { siteUrl } from "@/lib/email";
import { BILLING_INTERVALS, webhookUrl, type BillingInterval } from "@/lib/billing";
import { createCustomer, createFirstPayment } from "@/lib/mollie";

/**
 * Define a PENDING plan for a tenant without touching Mollie. Used by the admin
 * onboarding action: the referred partner completes the payment later.
 */
export async function defineTenantPlan(input: {
  tenantSlug: string;
  name: string;
  email: string;
  description: string;
  amountCents: number;
  interval: BillingInterval;
  liveSince: Date | null;
  clientId: string | null;
  actorId: string;
}) {
  const billing = await db.$transaction(async (tx) => {
    const b = await tx.tenantBilling.create({
      data: {
        tenantSlug: input.tenantSlug,
        name: input.name,
        email: input.email,
        // Null until the payer starts the first payment (schema note).
        mollieCustomerId: null,
        liveSince: input.liveSince ?? undefined,
        clientId: input.clientId ?? undefined,
      },
    });
    await tx.billingSubscription.create({
      data: {
        billingId: b.id,
        description: input.description,
        amountCents: input.amountCents,
        interval: BILLING_INTERVALS[input.interval].mollie,
        status: "PENDING",
      },
    });
    return b;
  });

  await audit(input.actorId, "billing.plan.defined", "TenantBilling", billing.id, {
    tenantSlug: input.tenantSlug,
  });
  return billing;
}

/** No PENDING plan to pay for (already active, canceled, or never defined). */
export class NoPendingPlanError extends Error {
  constructor() {
    super("no pending plan to start a payment for");
    this.name = "NoPendingPlanError";
  }
}

/** A first payment already succeeded; the plan is awaiting mandate validation +
 *  activation, NOT a new charge. Surfaced to the partner as "processing" —
 *  charging again here is the double-charge trap. */
export class FirstPaymentPaidError extends Error {
  constructor() {
    super("first payment already paid — plan is awaiting activation");
    this.name = "FirstPaymentPaidError";
  }
}

/**
 * Start the first payment for a tenant's PENDING plan and return the hosted
 * checkout URL. Creates the Mollie customer on first use. Idempotent enough for
 * a double-click: an existing still-open first payment is reused rather than
 * spawning a second checkout.
 */
export async function startFirstPayment(input: { billingId: string; actorId: string }) {
  const billing = await db.tenantBilling.findUnique({
    where: { id: input.billingId },
    // Only first payments matter here (the paid-guard + the reuse-open-checkout
    // guard); scope + bound so recurring history never floods this path.
    include: {
      subscriptions: true,
      payments: { where: { sequenceType: "first" }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!billing) throw new NoPendingPlanError();
  const pending = billing.subscriptions.find((s) => s.status === "PENDING");
  if (!pending) throw new NoPendingPlanError();

  // A first payment already succeeded → the plan is awaiting mandate validation
  // + activation (the ~80s..~26h webhook-retry window during which the sub can
  // still read PENDING), NOT awaiting payment. Refuse a second charge.
  if (billing.payments.some((p) => p.sequenceType === "first" && p.status === "paid")) {
    throw new FirstPaymentPaidError();
  }

  // Reuse a still-open first-payment checkout instead of creating a duplicate.
  const openFirst = billing.payments.find(
    (p) => p.sequenceType === "first" && (p.status === "open" || p.status === "pending") && p.checkoutUrl,
  );
  if (openFirst?.checkoutUrl) return { checkoutUrl: openFirst.checkoutUrl };

  // Create the Mollie customer on demand (the plan was defined without one),
  // claiming the column ATOMICALLY: two concurrent submits must not each create
  // a customer and overwrite the other — a paid payment on the overwritten
  // customer would no longer match the row and would be stranded.
  let customerId = billing.mollieCustomerId;
  if (!customerId) {
    const customer = await createCustomer({ name: billing.name, email: billing.email });
    const claimed = await db.tenantBilling.updateMany({
      where: { id: billing.id, mollieCustomerId: null },
      data: { mollieCustomerId: customer.id },
    });
    if (claimed.count === 1) {
      customerId = customer.id;
    } else {
      // Lost the race — another request set it first. Use the winner; our
      // just-created customer stays unused (no mandate/charge is attached).
      const fresh = await db.tenantBilling.findUnique({ where: { id: billing.id } });
      customerId = fresh?.mollieCustomerId ?? customer.id;
    }
  }

  const payment = await createFirstPayment(customerId, {
    amountCents: pending.amountCents,
    currency: pending.currency,
    description: `${pending.description} — first payment`,
    redirectUrl: `${siteUrl()}/billing/thanks`,
    webhookUrl: webhookUrl(),
  });
  const checkoutUrl = payment._links.checkout?.href ?? null;

  await db.billingPayment.upsert({
    where: { molliePaymentId: payment.id },
    create: {
      billingId: billing.id,
      molliePaymentId: payment.id,
      amountCents: pending.amountCents,
      currency: pending.currency,
      description: payment.description,
      status: payment.status,
      sequenceType: payment.sequenceType,
      checkoutUrl,
    },
    update: { status: payment.status, checkoutUrl },
  });

  await audit(input.actorId, "billing.firstpayment.started", "TenantBilling", billing.id, {
    tenantSlug: billing.tenantSlug,
    molliePaymentId: payment.id,
  });
  return { checkoutUrl };
}
