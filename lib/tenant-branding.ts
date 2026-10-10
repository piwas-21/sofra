import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { hiddenBranding, resolveTenantBranding } from "@/lib/tenant-branding-policy";

/** Reads only public projection; ambiguous ownership suppresses attribution. */
export async function publicTenantBranding(tenantSlug: string) {
  const registry = await loadTenantRegistry();
  if (!registry.ok) throw new Error("branding registry unavailable");
  const tenant = registry.tenants.find((row) => row.slug === tenantSlug && row.status === "active");
  if (!tenant) return null;
  const [preference, clients, billing] = await Promise.all([
    db.tenantBranding.findUnique({ where: { tenantSlug } }),
    db.client.findMany({
      where: { OR: [{ tenantSlug }, { billing: { tenantSlug } }] },
      take: 2,
      select: { id: true, partnerId: true, status: true, tenantSlug: true,
        partner: { select: { status: true, role: true, brand: true, billingIdentity: { select: { legalName: true } } } },
        billing: { select: { tenantSlug: true } },
      },
    }),
    db.tenantBilling.findUnique({ where: { tenantSlug }, select: { clientId: true, payerUserId: true } }),
  ]);
  if (tenant.partner_attribution === false || preference?.enabled === false) return hiddenBranding;
  const client = clients[0];
  if (clients.length > 1) return hiddenBranding;
  if (client && (client.tenantSlug !== tenantSlug || client.status !== "LIVE"
    || (client.billing && client.billing.tenantSlug !== tenantSlug)
    || (billing && (billing.clientId !== client.id || billing.payerUserId !== null)))) return hiddenBranding;
  // A legacy registry credit or an orphan reseller bill is not proof of no partner.
  if (!client && (tenant.partner_name?.trim() || billing?.clientId)) return hiddenBranding;
  return resolveTenantBranding({
    enabled: true, hasPartner: Boolean(client),
    partnerActive: client?.partner.status === "ACTIVE" && client.partner.role === "PARTNER",
    brand: client?.partner.brand ?? null, legalName: client?.partner.billingIdentity?.legalName,
  });
}
