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
import { partnerBrandRuntimeConfig } from "@/lib/partner-brand-config";

type MappedClient = {
  id: string;
  partnerId: string;
  tenantSlug: string | null;
  billing: { tenantSlug: string } | null;
};

type BillingClientMapping = { clientId: string | null; payerUserId: string | null } | null;
type PartnerClient = NonNullable<Awaited<ReturnType<typeof ownClient>>>;
type ApplyTargetResult =
  | { ok: true; client: PartnerClient; slug: string }
  | { ok: false; error: "clientNotFound" | "clientNotProvisioned" | "partnerBrandMappingAmbiguous" };

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

function mappingIsUnambiguous(
  mappedClients: MappedClient[],
  billing: BillingClientMapping,
  partnerId: string,
  clientId: string,
  slug: string,
): boolean {
  if (mappedClients.length !== 1) return false;
  const [mapped] = mappedClients;
  if (!mapped || mapped.id !== clientId || mapped.partnerId !== partnerId || mapped.tenantSlug !== slug) {
    return false;
  }
  if (mapped.billing !== null && mapped.billing?.tenantSlug !== slug) return false;
  return !billing || (billing.clientId === clientId && billing.payerUserId === null);
}

async function resolveApplyTarget(partnerId: string, clientId: string): Promise<ApplyTargetResult> {
  const client = await ownClient(partnerId, clientId);
  if (!client) return { ok: false, error: "clientNotFound" };
  if (client.status !== "LIVE" || !client.tenantSlug) {
    return { ok: false, error: "clientNotProvisioned" };
  }
  const slug = client.tenantSlug;

  // Both CRM directions must resolve to this partner's unique client before a
  // registry proposal can be opened.
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
  if (!mappingIsUnambiguous(mappedClients, billing, partnerId, client.id, slug)) {
    return { ok: false, error: "partnerBrandMappingAmbiguous" };
  }
  return { ok: true, client, slug };
}

async function loadRenderablePartnerBrand(partnerId: string) {
  const [storedBrand, identity] = await Promise.all([
    db.partnerBrand.findUnique({ where: { partnerId } }),
    db.billingIdentity.findUnique({ where: { userId: partnerId }, select: { legalName: true } }),
  ]);
  return renderableBrand(storedBrand, { legalName: identity?.legalName });
}

function proposalFailureState(error: unknown): PartnerBrandApplyState {
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

export async function applyPartnerBrandAction(
  _previous: PartnerBrandApplyState,
  formData: FormData,
): Promise<PartnerBrandApplyState> {
  const partner = await requirePartner();
  let config;
  try {
    config = partnerBrandRuntimeConfig();
  } catch {
    console.error("applyPartnerBrandAction rejected invalid partner-brand config");
    return { error: "partnerBrandApplyFailed" };
  }
  if (!rateLimit(`partner-brand-apply:${partner.id}`, config.applyMaxAttempts, config.applyWindowMs)) {
    return { error: "tooManyAttempts" };
  }
  const target = await resolveApplyTarget(partner.id, readString(formData, "clientId"));
  if (!target.ok) return { error: target.error };

  try {
    const publicBrand = await loadRenderablePartnerBrand(partner.id);
    const proposal = await openPartnerBrandRegistryPr(partner.id, target.slug, publicBrand);
    await audit(partner.id, "partner.brand.apply_requested", "Client", target.client.id, {
      tenantSlug: target.slug,
      outcome: proposal.kind,
      optedOut: proposal.optedOut,
      ...(proposal.kind === "unchanged" ? {} : { prUrl: proposal.prUrl }),
    });
    revalidatePath("/dashboard/brand");
    revalidatePath(`/dashboard/clients/${target.client.id}`);
    return {
      ok: true,
      outcome: proposal.kind === "opened" ? "proposed" : proposal.kind,
      optedOut: proposal.optedOut,
      ...(proposal.kind === "unchanged" ? {} : { prUrl: proposal.prUrl }),
    };
  } catch (error) {
    return proposalFailureState(error);
  }
}
