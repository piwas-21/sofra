"use server";

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { ownClient } from "@/lib/client-access";
import { partnerBrandRuntimeConfig } from "@/lib/partner-brand-config";
import { loadTenantRegistry } from "@/lib/tenant-registry";

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
  error?: string; ok?: boolean; outcome?: "applied"; optedOut?: boolean; enabled?: boolean;
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
  if (mapped?.id !== clientId || mapped.partnerId !== partnerId || mapped.tenantSlug !== slug) {
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
  // runtime display preference can be written.
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

export async function applyPartnerBrandAction(
  _previous: PartnerBrandApplyState, formData: FormData,
): Promise<PartnerBrandApplyState> {
  const partner = await requirePartner();
  try {
    const config = partnerBrandRuntimeConfig();
    if (!rateLimit(`partner-brand-apply:${partner.id}`, config.applyMaxAttempts, config.applyWindowMs)) {
      return { error: "tooManyAttempts" };
    }
    const target = await resolveApplyTarget(partner.id, readString(formData, "clientId"));
    if (!target.ok) return { error: target.error };
    const registry = await loadTenantRegistry();
    const tenant = registry.ok
      ? registry.tenants.find((row) => row.slug === target.slug && row.status === "active") : null;
    if (!tenant) return { error: "runtimeBrandApplyFailed" };
    const enabled = formData.get("enabled") !== "false";
    // A partner's show switch cannot override the restaurant-owned registry opt-out.
    await db.tenantBranding.upsert({
      where: { tenantSlug: target.slug },
      create: { tenantSlug: target.slug, enabled }, update: { enabled },
    });
    await audit(partner.id, "partner.brand.applied", "Client", target.client.id, {
      tenantSlug: target.slug, enabled, optedOut: tenant.partner_attribution === false,
    });
    revalidatePath("/dashboard/brand");
    return { ok: true, outcome: "applied", enabled, optedOut: tenant.partner_attribution === false };
  } catch {
    console.error("partner branding update unavailable");
    return { error: "runtimeBrandApplyFailed" };
  }
}
