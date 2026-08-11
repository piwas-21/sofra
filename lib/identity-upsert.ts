// Writing a billing identity against a plan. (SOFRA-BILLING-IDENTITY-PLAN B1/B5.)
//
// Shared verbatim by the admin form (/admin/billing/[id]) and the payer's own
// form (/dashboard/billing/details), and the sharing is the point rather than a
// convenience: the two surfaces differ ONLY in who is allowed to reach them. If
// the write logic were duplicated they would eventually disagree about what a
// failed VIES call may do to a previously proven status — and the surface that
// drifted would be the customer-facing one, which is the one nobody watches.
//
// Authorization is deliberately NOT here. Each caller does its own guard first
// (requireAdmin / requirePartnerOrOwner + an ownership test), so this file can
// never be mistaken for the thing that decides who may write.

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { vatFieldsFor, partyOf } from "@/lib/vat-check-fields";
import type { billingIdentitySchema } from "@/lib/billing-identity";
import type { z } from "zod";
import type { BillingIdentity } from "@/lib/generated/prisma/client";
import type { BuyerVatStatus } from "@/lib/tax-treatment";

export type IdentityInput = z.infer<typeof billingIdentitySchema>;

export type PlanForIdentity = {
  id: string;
  tenantSlug: string;
  billingIdentityId: string | null;
  payerUserId: string | null;
  client: { partnerId: string } | null;
  billingIdentity: BillingIdentity | null;
};

/**
 * The identity a plan is invoiced to: its own link, else the PARTY's.
 *
 * **Every reader must use this, not `plan.billingIdentity`.** The two differ for
 * any plan whose link is still null — which is every plan `defineTenantPlan`
 * creates — and a reader that disagrees with the writer is how a form comes to
 * overwrite a record it never displayed.
 *
 * That is not hypothetical: with the form reading the link and the write
 * resolving the party, a reseller opening their SECOND tenant saw eleven empty
 * fields under that tenant's name, filled them in, and silently rewrote their
 * FIRST tenant's legal entity — nulling its VAT number, its status and its VIES
 * consultation reference, the one stored thing that substantiates a reverse
 * charge. No failed VIES call anywhere in the path. It defeats the invariant the
 * rest of this feature is built around ("an outage must never erase a proven
 * VALID") through a door the outage rule does not watch: an empty field on a form
 * that never showed the value.
 */
export async function resolveIdentityForPlan(plan: PlanForIdentity) {
  if (plan.billingIdentity) return plan.billingIdentity;
  const userId = partyOf(plan);
  return userId ? await db.billingIdentity.findUnique({ where: { userId } }) : null;
}

/**
 * Create or update the identity this plan is invoiced to, and link it.
 *
 * Resolves through the PARTY, so a reseller's second tenant edits one legal
 * entity rather than minting a second that can drift from it. The create and the
 * link share a transaction — a created identity that failed to link would be an
 * orphan, and the next save would mint another beside it.
 *
 * `partyOf` assumes exactly one of `payerUserId` / `clientId` is set. That is not
 * enforced by the schema; `defineTenantPlan` (lib/billing-onboarding.ts) asserts
 * it and throws, and it is the only writer that sets both columns. If a second
 * writer ever appears, this is the assumption it must keep — with both set, a
 * reseller reaching a plan via `client.partnerId` would resolve to the direct
 * owner's identity and write to it.
 */
export async function upsertIdentityForPlan(
  plan: PlanForIdentity,
  input: IdentityInput,
  actorId: string,
) {
  const userId = partyOf(plan);
  // Narrowed for vatFieldsFor, which only cares about the number and its status.
  const existing = await resolveIdentityForPlan(plan);
  const storedVat = existing
    ? { vatNumber: existing.vatNumber, vatStatus: existing.vatStatus as BuyerVatStatus }
    : null;

  const vat = await vatFieldsFor(input.vatNumber ?? "", storedVat);

  const fields = {
    legalName: input.legalName,
    tradeName: input.tradeName || null,
    legalForm: input.legalForm || null,
    registrationNo: input.registrationNo || null,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 || null,
    postalCode: input.postalCode,
    city: input.city,
    countryCode: input.countryCode,
    billingEmail: input.billingEmail,
    ...vat,
  };

  const identity = await db.$transaction(async (tx) => {
    const saved = existing
      ? await tx.billingIdentity.update({ where: { id: existing.id }, data: fields })
      : await tx.billingIdentity.create({ data: { ...fields, userId } });
    if (plan.billingIdentityId !== saved.id) {
      await tx.tenantBilling.update({
        where: { id: plan.id },
        data: { billingIdentityId: saved.id },
      });
    }
    return saved;
  });

  // The VAT status is the audit-relevant part: it is what a reverse charge rests
  // on. Ids only — no legal name, address or number in the log (§5.8).
  await audit(actorId, "billing.identity.saved", "BillingIdentity", identity.id, {
    tenantSlug: plan.tenantSlug,
    vatStatus: vat.vatStatus,
    evidenced: Boolean(identity.vatCheckRef),
  });

  return { identity, vatStatus: vat.vatStatus };
}
