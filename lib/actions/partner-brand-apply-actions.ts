"use server";

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { ownClient } from "@/lib/client-access";
import { renderableBrand } from "@/lib/partner-brand";
import {
  openPartnerBrandRegistryPr,
  PartnerBrandProposalConflictError,
} from "@/lib/partner-brand-registry-pr";
import {
  AmbiguousPartnerBrandRegistryError,
  IneligiblePartnerBrandTenantError,
  UnknownPartnerBrandTenantError,
} from "@/lib/partner-brand-registry-edit";
import { ProvisioningApiError, ProvisioningNotConfiguredError } from "@/lib/provisioning";

export type PartnerBrandApplyState = {
  error?: string;
  ok?: boolean;
  outcome?: "proposed" | "pending" | "unchanged";
  prUrl?: string;
  optedOut?: boolean;
};

const readString = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function applyPartnerBrandAction(
  _previous: PartnerBrandApplyState,
  formData: FormData,
): Promise<PartnerBrandApplyState> {
  const partner = await requirePartner();
  if (!rateLimit(`partner-brand-apply:${partner.id}`, 12, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const client = await ownClient(partner.id, readString(formData, "clientId"));
  if (!client) return { error: "clientNotFound" };
  if (client.status !== "LIVE" || !client.tenantSlug) return { error: "clientNotProvisioned" };
  const slug = client.tenantSlug;

  // A tenant slug is not accepted from the browser. Re-check both directions of
  // the CRM/billing join so a direct-owner billing row or stale mapping cannot be
  // treated as this partner's registered site.
  const [mappedClients, billing] = await Promise.all([
    db.client.findMany({
      where: { OR: [{ tenantSlug: slug }, { billing: { tenantSlug: slug } }] },
      take: 2,
      select: {
        id: true,
        partnerId: true,
        tenantSlug: true,
        billing: { select: { tenantSlug: true } },
      },
    }),
    db.tenantBilling.findUnique({
      where: { tenantSlug: slug },
      select: { clientId: true, payerUserId: true },
    }),
  ]);
  const mapped = mappedClients[0];
  if (
    mappedClients.length !== 1 ||
    !mapped ||
    mapped.id !== client.id ||
    mapped.partnerId !== partner.id ||
    mapped.tenantSlug !== slug ||
    (mapped.billing && mapped.billing.tenantSlug !== slug) ||
    (billing && (billing.clientId !== client.id || billing.payerUserId !== null))
  ) {
    return { error: "partnerBrandMappingAmbiguous" };
  }

  // Legal identity is consulted only for the D-B1a refusal. The only value passed
  // to the registry proposal is `renderableBrand`: public name plus optional HTTPS
  // URL, never legal identity, email, phone, address, or any other private field.
  const [storedBrand, identity] = await Promise.all([
    db.partnerBrand.findUnique({ where: { partnerId: partner.id } }),
    db.billingIdentity.findUnique({ where: { userId: partner.id }, select: { legalName: true } }),
  ]);
  const publicBrand = renderableBrand(storedBrand, { legalName: identity?.legalName });

  try {
    const proposal = await openPartnerBrandRegistryPr(partner.id, slug, publicBrand);
    await audit(partner.id, "partner.brand.apply_requested", "Client", client.id, {
      tenantSlug: slug,
      outcome: proposal.kind,
      optedOut: proposal.optedOut,
      ...(proposal.kind === "unchanged" ? {} : { prUrl: proposal.prUrl }),
    });
    revalidatePath("/dashboard/brand");
    revalidatePath(`/dashboard/clients/${client.id}`);
    return {
      ok: true,
      outcome: proposal.kind === "opened" ? "proposed" : proposal.kind,
      optedOut: proposal.optedOut,
      ...(proposal.kind === "unchanged" ? {} : { prUrl: proposal.prUrl }),
    };
  } catch (error) {
    if (error instanceof ProvisioningNotConfiguredError) return { error: "partnerBrandProposalUnavailable" };
    if (error instanceof PartnerBrandProposalConflictError) {
      return {
        error: "partnerBrandProposalConflict",
        ...(error.prUrl ? { prUrl: error.prUrl } : {}),
      };
    }
    if (
      error instanceof ProvisioningApiError ||
      error instanceof UnknownPartnerBrandTenantError ||
      error instanceof IneligiblePartnerBrandTenantError ||
      error instanceof AmbiguousPartnerBrandRegistryError
    ) {
      return { error: "partnerBrandApplyFailed" };
    }
    console.error("applyPartnerBrandAction failed", error instanceof Error ? error.name : "unknown error");
    return { error: "partnerBrandApplyFailed" };
  }
}
