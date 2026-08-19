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
import { trialEndForNewPlan } from "@/lib/trial";
import { siteUrl } from "@/lib/email";
import { BILLING_INTERVALS, webhookUrl, type BillingInterval } from "@/lib/billing";
import { createCustomer, createFirstPayment } from "@/lib/mollie";
import { isCheckoutFresh } from "@/lib/checkout-window";
import {
  FirstPaymentPaidError,
  InvalidPayerError,
  NoPendingPlanError,
} from "@/lib/billing-errors";

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
  // Reseller flow: the CRM Client (payer derived from client.partner). Owner flow
  // (ADR-004): payerUserId is the direct owner and clientId is null. Exactly one.
  clientId: string | null;
  payerUserId?: string | null;
  actorId: string;
}) {
  // "Exactly one of clientId / payerUserId" is the shape the rest of the system
  // reads (the dashboard picks the partner CRM surface or the owner surface off
  // it). It is a convention, not a DB constraint, so assert it where the row is
  // written rather than discovering a two-headed plan from a rendering bug.
  const payerRefs = [input.clientId, input.payerUserId].filter(Boolean).length;
  if (payerRefs !== 1) {
    throw new InvalidPayerError(
      `a plan needs exactly one payer reference (clientId XOR payerUserId), got ${payerRefs}`,
    );
  }

  // The free period (T2), decided from the payer shape asserted just above rather
  // than from a caller-supplied flag: `clientId` set = reseller-paid = one month
  // free; a direct self-serve owner gets null, because their pay-before-provision
  // gate is the abuse defence. The rule and its reasoning live in lib/trial.ts.
  const trialEndsAt = trialEndForNewPlan({ resellerPaid: Boolean(input.clientId), now: new Date() });

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
        payerUserId: input.payerUserId ?? undefined,
        trialEndsAt: trialEndsAt ?? undefined,
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

  // The trial is audited with the plan that granted it: "why is this tenant free
  // until October" must be answerable a quarter later, and the column alone says
  // nothing about when or by whom it was set.
  await audit(input.actorId, "billing.plan.defined", "TenantBilling", billing.id, {
    tenantSlug: input.tenantSlug,
    trialEndsAt: trialEndsAt?.toISOString() ?? null,
  });
  return billing;
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

  // Reuse a still-open first-payment checkout instead of creating a duplicate —
  // but only a FRESH one. Mollie hosted-checkout URLs expire (~1h), and an
  // expired one sends the payer to a Mollie error page with no way forward,
  // which looks like a broken product rather than a stale link. Past the
  // threshold we mint a new checkout; the old payment stays `open` and simply
  // expires, so this cannot double-charge (a `paid` first payment is refused
  // above, before this point).
  const openFirst = billing.payments.find(
    (p) =>
      p.sequenceType === "first" &&
      (p.status === "open" || p.status === "pending") &&
      p.checkoutUrl &&
      isCheckoutFresh(p.createdAt),
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
