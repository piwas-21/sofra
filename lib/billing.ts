// Billing service (S9 — ADR-005/ADR-011 Job A): the shared logic between the
// admin server actions and the Mollie webhook. Flow:
//
//   1. admin creates a TenantBilling (Mollie customer) + a PENDING plan
//      (BillingSubscription) + a hosted-checkout FIRST payment
//   2. tenant pays the checkout once -> Mollie creates a recurring mandate
//   3. the webhook re-fetches the paid first payment and activates the
//      pending plan as a real Mollie subscription (start = one interval out,
//      because the first payment already collected the first period)
//   4. each recurring charge arrives via the same webhook and is mirrored
//      into BillingPayment
//
// Mollie is the source of truth; nothing here trusts webhook bodies.

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { eur } from "@/lib/format";
import {
  createCustomer,
  createFirstPayment,
  createSubscription,
  hasValidMandate,
  type MolliePayment,
} from "@/lib/mollie";

export const BILLING_INTERVALS = {
  month: { mollie: "1 month", months: 1, label: "Monthly" },
  quarter: { mollie: "3 months", months: 3, label: "Quarterly" },
  year: { mollie: "12 months", months: 12, label: "Yearly" },
} as const;
export type BillingInterval = keyof typeof BILLING_INTERVALS;

function webhookUrl() {
  return `${siteUrl()}/api/webhooks/mollie`;
}

/**
 * First charge date for the Mollie subscription: one interval after the
 * first payment. JS Date month arithmetic overflows month-end (Jan 31 + 1mo
 * -> Mar 3) — a 1–3 day drift for month-end signups we accept in v1.
 */
function subscriptionStartDate(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Create the Mollie customer + PENDING plan + first-payment checkout.
 * Returns the checkout URL for the founder to hand to the tenant.
 */
export async function createTenantBilling(input: {
  tenantSlug: string;
  name: string;
  email: string;
  description: string;
  amountCents: number;
  interval: BillingInterval;
  actorId: string;
}) {
  // Both Mollie calls happen BEFORE any DB write: a failure here leaves at
  // worst an orphan Mollie customer / an unpaid open payment (harmless,
  // expires) and the action can simply be retried — never a half-created
  // TenantBilling that dead-ends on the unique tenantSlug.
  const customer = await createCustomer({ name: input.name, email: input.email });
  const payment = await createFirstPayment(customer.id, {
    amountCents: input.amountCents,
    description: `${input.description} — first payment`,
    redirectUrl: `${siteUrl()}/billing/thanks`,
    webhookUrl: webhookUrl(),
  });

  // Auto-link the partner-CRM client that carries this tenant slug, if any.
  const client = await db.client.findUnique({ where: { tenantSlug: input.tenantSlug } });

  const checkoutUrl = payment._links.checkout?.href ?? null;
  const billing = await db.$transaction(async (tx) => {
    const b = await tx.tenantBilling.create({
      data: {
        tenantSlug: input.tenantSlug,
        name: input.name,
        email: input.email,
        mollieCustomerId: customer.id,
        clientId: client?.id,
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
    await tx.billingPayment.create({
      data: {
        billingId: b.id,
        molliePaymentId: payment.id,
        amountCents: input.amountCents,
        description: payment.description,
        status: payment.status,
        sequenceType: payment.sequenceType,
        checkoutUrl,
      },
    });
    return b;
  });

  await audit(input.actorId, "billing.created", "TenantBilling", billing.id, {
    tenantSlug: input.tenantSlug,
    mollieCustomerId: customer.id,
    firstPaymentId: payment.id,
  });

  return { billing, checkoutUrl };
}

/**
 * Webhook entry point for a re-fetched payment: mirror it locally and, on a
 * paid FIRST payment, activate any pending plans. Idempotent — Mollie may
 * deliver the same webhook more than once.
 */
export async function recordPayment(payment: MolliePayment) {
  if (!payment.customerId) return;
  const billing = await db.tenantBilling.findUnique({
    where: { mollieCustomerId: payment.customerId },
    include: { subscriptions: true },
  });
  if (!billing) return;

  const amountCents = Math.round(parseFloat(payment.amount.value) * 100);
  await db.billingPayment.upsert({
    where: { molliePaymentId: payment.id },
    create: {
      billingId: billing.id,
      molliePaymentId: payment.id,
      mollieSubscriptionId: payment.subscriptionId,
      amountCents,
      currency: payment.amount.currency,
      description: payment.description,
      status: payment.status,
      sequenceType: payment.sequenceType,
      method: payment.method,
      paidAt: payment.paidAt ? new Date(payment.paidAt) : undefined,
    },
    update: {
      status: payment.status,
      method: payment.method,
      mollieSubscriptionId: payment.subscriptionId,
      paidAt: payment.paidAt ? new Date(payment.paidAt) : undefined,
      // A paid/expired checkout link is dead — stop surfacing it.
      ...(payment.status !== "open" && payment.status !== "pending"
        ? { checkoutUrl: null }
        : {}),
    },
  });
  await audit(null, `billing.payment.${payment.status}`, "BillingPayment", payment.id, {
    tenantSlug: billing.tenantSlug,
    sequenceType: payment.sequenceType,
  });

  if (payment.sequenceType === "first" && payment.status === "paid") {
    await activatePendingSubscriptions(billing.id, billing.mollieCustomerId);
  }

  await notifyFounder(billing.tenantSlug, payment, amountCents);
}

/** Create the real Mollie subscription for every PENDING plan (idempotent). */
async function activatePendingSubscriptions(billingId: string, mollieCustomerId: string) {
  // ACTIVATING rows are stranded claims from a run that hard-crashed between
  // claim and completion — re-enter them; the per-plan Idempotency-Key makes
  // the repeated Mollie call return the same subscription, so this self-heals.
  const pending = await db.billingSubscription.findMany({
    where: { billingId, status: { in: ["PENDING", "ACTIVATING"] }, mollieSubscriptionId: null },
  });
  if (pending.length === 0) return;
  if (!(await hasValidMandate(mollieCustomerId))) return; // webhook races the mandate — next webhook retries

  for (const plan of pending) {
    if (plan.status === "PENDING") {
      // Atomically CLAIM the plan before the external call — a concurrent
      // webhook delivery (Mollie retries are expected) must not activate the
      // same plan twice, or the tenant gets two charging subscriptions.
      const claimed = await db.billingSubscription.updateMany({
        where: { id: plan.id, status: "PENDING", mollieSubscriptionId: null },
        data: { status: "ACTIVATING" },
      });
      if (claimed.count === 0) continue; // another delivery holds the claim
    }

    const months =
      Object.values(BILLING_INTERVALS).find((i) => i.mollie === plan.interval)?.months ?? 1;
    const startDate = subscriptionStartDate(months);
    try {
      // Idempotency-Key = plan id: even if we crash between the Mollie call
      // and the update below, the retried call returns the SAME subscription
      // instead of creating a second one.
      const sub = await createSubscription(mollieCustomerId, {
        amountCents: plan.amountCents,
        currency: plan.currency,
        interval: plan.interval,
        description: plan.description,
        webhookUrl: webhookUrl(),
        startDate,
        idempotencyKey: plan.id,
      });
      await db.billingSubscription.update({
        where: { id: plan.id },
        data: {
          mollieSubscriptionId: sub.id,
          status: "ACTIVE",
          startDate: new Date(`${sub.startDate}T00:00:00Z`),
        },
      });
      await audit(null, "billing.subscription.activated", "BillingSubscription", plan.id, {
        mollieSubscriptionId: sub.id,
        startDate: sub.startDate,
      });
    } catch (e) {
      // Release the claim so the webhook retry can reprocess immediately;
      // even if THIS release is lost to a crash, the ACTIVATING row is
      // re-entered by the recovery filter above.
      await db.billingSubscription.updateMany({
        where: { id: plan.id, status: "ACTIVATING", mollieSubscriptionId: null },
        data: { status: "PENDING" },
      });
      throw e;
    }
  }
}

/** Founder notification on money events — paid, or anything gone wrong. */
async function notifyFounder(tenantSlug: string, payment: MolliePayment, amountCents: number) {
  const interesting =
    payment.status === "paid" ||
    payment.status === "failed" ||
    payment.status === "expired" ||
    payment.status === "canceled";
  if (!interesting) return;
  const inbox = founderInbox();
  if (!inbox) return;
  const ok = payment.status === "paid";
  await sendEmail({
    to: inbox,
    subject: `[Sofra billing] ${tenantSlug}: ${payment.sequenceType} payment ${payment.status} (${eur(amountCents)})`,
    html: craftEmail({
      kicker: "Billing",
      title: ok ? "Payment received" : `Payment ${payment.status}`,
      // detailRows escapes both columns itself.
      bodyHtml: detailRows([
        ["Tenant", tenantSlug],
        ["Amount", eur(amountCents)],
        ["Type", payment.sequenceType],
        ["Status", payment.status],
        ["Mollie id", payment.id],
      ]),
      footerNote: ok
        ? "Mirrored into the control plane automatically."
        : "Check the Mollie dashboard — a failed recurring charge may need dunning.",
    }),
  });
}
