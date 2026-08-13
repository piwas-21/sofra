"use server";

// Deleting a billing plan. (SOFRA-BILLING-IDENTITY-PLAN B11.)
//
// The only destructive action in the control plane, so it is deliberately harder
// to reach than anything else here: admin-only, guarded by `planDeletionVerdict`,
// and it requires the operator to TYPE the tenant slug. The typed slug is not
// theatre — the id travels in a hidden field, and a mis-click on the wrong row is
// exactly the mistake that has no undo.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { planDeletionVerdict, settledOrInFlight } from "@/lib/plan-deletion";

export type DeletePlanState = { error?: string; ok?: boolean; deletedSlug?: string };

export async function deleteBillingPlanAction(
  _prev: DeletePlanState,
  formData: FormData,
): Promise<DeletePlanState> {
  const admin = await requireAdmin();

  const billingId = String(formData.get("billingId") ?? "");
  const typedSlug = String(formData.get("confirmSlug") ?? "").trim();

  const billing = await db.tenantBilling.findUnique({
    where: { id: billingId },
    include: { subscriptions: true, payments: true },
  });
  if (!billing) return { error: "planNotFound" };

  // Case-sensitive: slugs are lowercase by grammar, so a mismatch here means the
  // operator typed a different tenant's name, which is the case worth stopping.
  if (typedSlug !== billing.tenantSlug) return { error: "confirmSlugMismatch" };

  // Invoices are found by SLUG, not by a foreign key — see planDeletionVerdict.
  const invoiceCount = await db.invoice.count({ where: { tenantSlug: billing.tenantSlug } });
  const verdict = planDeletionVerdict({
    invoiceCount,
    liveOrSettledPaymentCount: billing.payments.filter((p) => settledOrInFlight(p.status)).length,
    liveSubscriptionCount: billing.subscriptions.filter((s) =>
      ["PENDING", "ACTIVATING", "ACTIVE"].includes(s.status),
    ).length,
    hasMollieCustomer: Boolean(billing.mollieCustomerId),
  });
  if (!verdict.deletable) return { error: `planDelete.${verdict.blocker}` };

  // Captured BEFORE the delete because afterwards there is no row to describe —
  // but WRITTEN after, so a run that loses the race below never records a
  // deletion that did not happen. `mollieCustomerId` is an id, not PII, and is
  // exactly what an operator needs to clean up at Mollie later.
  const record = {
    tenantSlug: billing.tenantSlug,
    subscriptions: billing.subscriptions.length,
    payments: billing.payments.length,
    orphanedMollieCustomer: billing.mollieCustomerId ?? null,
  };

  // Re-check under a ROW LOCK, then delete in the same transaction.
  //
  // The verdict above was computed from a read, and a webhook can settle a
  // payment between that read and this delete — which is the one moment the
  // guards exist for, since after the delete `recordPayment` finds no plan and
  // returns silently with a 200. READ COMMITTED alone does not close it: a plain
  // transaction would still see the pre-webhook snapshot. `FOR UPDATE` makes the
  // webhook's write wait, so the recount sees it.
  //
  // Subscriptions and payments cascade (schema `onDelete: Cascade`); the billing
  // identity does NOT — it is `SetNull` and belongs to the party, who may hold
  // other plans.
  const raced = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TenantBilling" WHERE id = ${billing.id} FOR UPDATE`;
    const live = await tx.billingPayment.count({
      where: { billingId: billing.id, status: { notIn: ["failed", "canceled", "expired"] } },
    });
    if (live > 0) return true;
    await tx.tenantBilling.delete({ where: { id: billing.id } });
    return false;
  });
  if (raced) return { error: "planDelete.hasPaidPayments" };

  await audit(admin.id, "billing.plan.deleted", "TenantBilling", billing.id, record);

  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  return { ok: true, deletedSlug: billing.tenantSlug };
}
