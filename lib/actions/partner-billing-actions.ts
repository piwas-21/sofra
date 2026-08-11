"use server";

// Payer-facing billing. A logged-in payer — a reseller PARTNER (via their CRM
// client) or a direct OWNER (via payerUserId, ADR-004) — starts the first
// payment for a tenant they own, which creates the Mollie customer + hosted
// checkout; the browser then redirects to Mollie. The recurring subscription is
// activated by the existing webhook (lib/billing.ts).

import { redirect } from "next/navigation";
import { requirePartnerOrOwner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { startFirstPayment } from "@/lib/billing-onboarding";
import { FirstPaymentPaidError, NoPendingPlanError } from "@/lib/billing-errors";
import { mollieConfigured, MollieError } from "@/lib/mollie";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";

/** `error` is a message key in `control.errors` (translated by <ActionError />);
 *  Mollie API errors pass through raw. On success the action redirects to the
 *  Mollie hosted checkout (server-side → works as a plain form POST too). */
export type StartPaymentState = { error?: string };

export async function startPaymentAction(
  _prev: StartPaymentState,
  formData: FormData,
): Promise<StartPaymentState> {
  const user = await requirePartnerOrOwner();
  if (!mollieConfigured()) return { error: "mollieNotConfigured" };

  // Money-adjacent + network op → rate-limit per payer. This action is
  // authenticated, so user.id beats IP: no NAT collisions (payers behind one
  // router), no dependency on proxy headers, and nothing to spoof.
  if (!rateLimit(`start-payment:${user.id}`, 10, 15 * 60 * 1000)) return { error: "tooManyAttempts" };

  const rawBillingId = formData.get("billingId");
  const billingId = typeof rawBillingId === "string" ? rawBillingId : "";
  const billing = await db.tenantBilling.findUnique({
    where: { id: billingId },
    include: { client: true, subscriptions: true, billingIdentity: true },
  });
  // Ownership: the caller is either the direct OWNER named as payerUserId, or the
  // reseller PARTNER behind the CRM client. A billing they own neither way is
  // invisible to them.
  const owns = !!billing && (billing.payerUserId === user.id || billing.client?.partnerId === user.id);
  if (!billing || !owns) return { error: "planNotFound" };
  if (billing.subscriptions.some((s) => s.status === "ACTIVE")) return { error: "alreadyActive" };

  // No charge may settle that cannot then be invoiced (B4/B5). This is the only
  // point where that is cheap to enforce: afterwards the money has moved, the
  // webhook has answered 200 and will never be redelivered, and the charge sits
  // on /admin/invoices waiting for someone to notice.
  //
  // Deliberately placed AFTER the alreadyActive check, so it can only ever gate a
  // NEW first payment. An existing ACTIVE subscription — RUMI's, and every plan
  // that predates this programme — keeps charging untouched; retrofitting a
  // precondition onto live subscriptions would be a different and much riskier
  // change than requiring it of the next one.
  // Resolved through the PARTY, not the plan link. A reseller who already has a
  // complete, VIES-valid identity on file from their first tenant gets a SECOND
  // plan with `billingIdentityId` null (that is how defineTenantPlan creates
  // every plan), and reading the link alone would refuse a payment we have
  // everything needed to invoice — pushing them at a blank form for a record
  // that already exists.
  if (!isInvoiceable(await resolveIdentityForPlan(billing))) {
    return { error: "billingDetailsRequired" };
  }

  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = (await startFirstPayment({ billingId: billing.id, actorId: user.id })).checkoutUrl;
  } catch (e) {
    if (e instanceof FirstPaymentPaidError) return { error: "paymentProcessing" };
    if (e instanceof NoPendingPlanError) return { error: "planNotFound" };
    if (e instanceof MollieError) return { error: e.message };
    console.error("startPaymentAction failed", e);
    return { error: "startPaymentFailed" };
  }
  if (!checkoutUrl) return { error: "startPaymentFailed" };
  // Outside the try: redirect() throws NEXT_REDIRECT, which must propagate.
  redirect(checkoutUrl);
}
