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
import {
  startFirstPayment,
  NoPendingPlanError,
  FirstPaymentPaidError,
} from "@/lib/billing-onboarding";
import { mollieConfigured, MollieError } from "@/lib/mollie";

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
    include: { client: true, subscriptions: true },
  });
  // Ownership: the caller is either the direct OWNER named as payerUserId, or the
  // reseller PARTNER behind the CRM client. A billing they own neither way is
  // invisible to them.
  const owns = !!billing && (billing.payerUserId === user.id || billing.client?.partnerId === user.id);
  if (!billing || !owns) return { error: "planNotFound" };
  if (billing.subscriptions.some((s) => s.status === "ACTIVE")) return { error: "alreadyActive" };

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
