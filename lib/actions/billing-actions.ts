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
    return { error: "Mollie is not configured (MOLLIE_API_KEY missing on this environment)." };
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const input = parsed.data;

  if (await db.tenantBilling.findUnique({ where: { tenantSlug: input.tenantSlug } })) {
    return { error: `Billing for tenant '${input.tenantSlug}' already exists.` };
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
    return { error: "Creating the billing account failed — see server logs." };
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
  if (!sub) return { error: "Subscription not found." };
  if (sub.status === "ACTIVATING") {
    // A Mollie subscription may exist mid-flight — cancelling locally now
    // could orphan a charging subscription. The state self-heals via the
    // webhook; cancel once it settles.
    return { error: "Activation in flight — retry once the plan settles." };
  }

  try {
    // PENDING plans (no Mollie subscription yet) cancel locally only.
    if (sub.mollieSubscriptionId) {
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
    return { error: "Cancelling failed — see server logs." };
  }
}
