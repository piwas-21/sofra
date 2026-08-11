"use server";

// Recording the legal entity a tenant's subscription is invoiced to, and
// checking its VAT number. (SOFRA-BILLING-IDENTITY-PLAN B1/B2.)
//
// Admin-only in this slice: the founder enters what the customer told them. B5
// gives the payer the same form for their own plan; the rules below are shared
// so the two surfaces cannot drift on the one decision that matters — what a
// failed VIES call is allowed to do to a previously proven status.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { billingIdentitySchema } from "@/lib/billing-identity";
import { vatFieldsFor } from "@/lib/vat-check-fields";
import { upsertIdentityForPlan } from "@/lib/identity-upsert";
import type { BuyerVatStatus } from "@/lib/tax-treatment";

/** `error` is a message key in `control.errors` (translated by <ActionError />);
 *  Zod issue messages pass through raw, as elsewhere in this directory. */
export type IdentityActionState = { error?: string; ok?: boolean; vatStatus?: BuyerVatStatus };

export async function saveBillingIdentityAction(
  _prev: IdentityActionState,
  formData: FormData,
): Promise<IdentityActionState> {
  const admin = await requireAdmin();

  // A network call to a third party, reachable from a form. Bounded per admin —
  // authenticated, so the actor id beats an IP (no NAT collisions, nothing to
  // spoof), matching startPaymentAction.
  if (!rateLimit(`billing-identity:${admin.id}`, 30, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const billingId = String(formData.get("billingId") ?? "");
  const parsed = billingIdentitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const input = parsed.data;

  const billing = await db.tenantBilling.findUnique({
    where: { id: billingId },
    include: { billingIdentity: true, client: { select: { partnerId: true } } },
  });
  if (!billing) return { error: "planNotFound" };

  const { vatStatus } = await upsertIdentityForPlan(billing, input, admin.id);

  revalidatePath(`/admin/billing/${billing.id}`);
  return { ok: true, vatStatus };
}

/**
 * Re-run the VIES check on an identity without touching its other fields.
 *
 * The exit from `UNAVAILABLE`, which is a routine outcome rather than an edge
 * case — VIES throttles hard — so "ask again later" has to be one click. It is
 * also how an INVALID becomes VALID once a customer activates their number,
 * which is exactly the trigger case in the plan (§2b): the partner's number is
 * real but not yet published to VIES, and nothing else about their record will
 * change on the day it is.
 *
 * Deliberately re-asks even for a settled status — unlike a save, asking IS the
 * point here.
 */
export async function recheckVatAction(
  _prev: IdentityActionState,
  formData: FormData,
): Promise<IdentityActionState> {
  const admin = await requireAdmin();
  if (!rateLimit(`vat-recheck:${admin.id}`, 30, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const identityId = String(formData.get("identityId") ?? "");
  const identity = await db.billingIdentity.findUnique({ where: { id: identityId } });
  if (!identity) return { error: "identityNotFound" };
  if (!identity.vatNumber) return { error: "noVatNumber" };

  // `force` so a settled status does not swallow the request — asking IS the
  // point here — while the stored number is passed truthfully, so a VALID still
  // survives an outage.
  const vat = await vatFieldsFor(
    identity.vatNumber,
    { vatNumber: identity.vatNumber, vatStatus: identity.vatStatus as BuyerVatStatus },
    { force: true },
  );
  await db.billingIdentity.update({ where: { id: identity.id }, data: vat });
  await audit(admin.id, "billing.identity.vatChecked", "BillingIdentity", identity.id, {
    vatStatus: vat.vatStatus,
    evidenced: Boolean(vat.vatCheckRef),
  });

  // The literal path, so the dynamic child re-renders too.
  revalidatePath("/admin/billing/[id]", "page");
  return { ok: true, vatStatus: vat.vatStatus };
}
