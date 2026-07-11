"use server";

// Admin-only billing actions (S9 — ADR-005/ADR-011 Job A). Thin wrappers:
// validation + RBAC here, Mollie/DB logic in lib/billing.ts.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { billingSchema } from "@/lib/validation";
import { createTenantBilling, type BillingInterval } from "@/lib/billing";
import { mollieConfigured, cancelSubscription, MollieError } from "@/lib/mollie";

/** `error` is a message key in `control.errors` (translated at render by
 *  <ActionError />); Zod issue messages and Mollie API errors pass through
 *  raw and render verbatim. */
export type BillingActionState = {
  error?: string;
  ok?: boolean;
  checkoutUrl?: string;
};

export async function createBillingAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const admin = await requireAdmin();
  if (!mollieConfigured()) {
    return { error: "mollieNotConfigured" };
  }

  const parsed = billingSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    name: formData.get("name"),
    email: formData.get("email"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    interval: formData.get("interval"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  }
  const input = parsed.data;

  if (await db.tenantBilling.findUnique({ where: { tenantSlug: input.tenantSlug } })) {
    return { error: "billingExists" };
  }

  try {
    const { checkoutUrl } = await createTenantBilling({
      tenantSlug: input.tenantSlug,
      name: input.name,
      email: input.email,
      description: input.description,
      amountCents: Math.round(input.amount * 100),
      interval: input.interval as BillingInterval,
      actorId: admin.id,
    });
    revalidatePath("/admin/billing");
    return { ok: true, checkoutUrl: checkoutUrl ?? undefined };
  } catch (e) {
    if (e instanceof MollieError) return { error: e.message };
    console.error("createBillingAction failed", e);
    return { error: "billingCreateFailed" };
  }
}

export async function cancelSubscriptionAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");

  const sub = await db.billingSubscription.findUnique({
    where: { id },
    include: { billing: true },
  });
  if (!sub) return { error: "subscriptionNotFound" };
  if (sub.status === "ACTIVATING") {
    // A Mollie subscription may exist mid-flight — cancelling locally now
    // could orphan a charging subscription. The state self-heals via the
    // webhook; cancel once it settles.
    return { error: "activationInFlight" };
  }

  try {
    // PENDING plans (no Mollie subscription yet) cancel locally only. A live
    // subscription always has a Mollie customer; the null-guard just satisfies
    // the (now-nullable) type — a subscription id can't exist without one.
    if (sub.mollieSubscriptionId && sub.billing.mollieCustomerId) {
      await cancelSubscription(sub.billing.mollieCustomerId, sub.mollieSubscriptionId);
    }
    await db.billingSubscription.update({
      where: { id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    await audit(admin.id, "billing.subscription.canceled", "BillingSubscription", id, {
      tenantSlug: sub.billing.tenantSlug,
      mollieSubscriptionId: sub.mollieSubscriptionId,
    });
    revalidatePath("/admin/billing");
    revalidatePath(`/admin/billing/${sub.billingId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof MollieError) return { error: e.message };
    console.error("cancelSubscriptionAction failed", e);
    return { error: "cancelFailed" };
  }
}
