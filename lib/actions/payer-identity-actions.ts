"use server";

// The payer's own billing details. (SOFRA-BILLING-IDENTITY-PLAN B5.)
//
// Same write path as the admin form — `upsertIdentityForPlan` — and deliberately
// so: the two surfaces must never disagree about what a failed VIES call may do
// to a proven status, and the one that would drift unnoticed is this one.
//
// What differs is the guard. A payer may edit the identity of a plan they pay
// for and nothing else, resolved through the SAME two links the rest of billing
// uses (`payerUserId` for a direct owner, `client.partnerId` for a reseller).

import { revalidatePath } from "next/cache";
import { requirePartnerOrOwner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { billingIdentitySchema } from "@/lib/billing-identity";
import { upsertIdentityForPlan } from "@/lib/identity-upsert";
import type { BuyerVatStatus } from "@/lib/tax-treatment";

export type PayerIdentityState = { error?: string; ok?: boolean; vatStatus?: BuyerVatStatus };

export async function savePayerIdentityAction(
  _prev: PayerIdentityState,
  formData: FormData,
): Promise<PayerIdentityState> {
  const user = await requirePartnerOrOwner();

  // Money-adjacent and reaches a third-party API. Keyed on the authenticated
  // user rather than the IP — no NAT collisions, nothing to spoof.
  if (!rateLimit(`payer-identity:${user.id}`, 20, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const billingId = String(formData.get("billingId") ?? "");
  const parsed = billingIdentitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };

  const billing = await db.tenantBilling.findUnique({
    where: { id: billingId },
    include: { billingIdentity: true, client: { select: { partnerId: true } } },
  });
  // A plan they own neither way is invisible, not forbidden — the same shape the
  // rest of the payer surface uses, so an id cannot be used to probe for others'.
  const owns =
    !!billing &&
    (billing.payerUserId === user.id || billing.client?.partnerId === user.id);
  if (!billing || !owns) return { error: "planNotFound" };

  const { vatStatus } = await upsertIdentityForPlan(billing, parsed.data, user.id);

  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard");
  return { ok: true, vatStatus };
}
