import platform from "@/config/tenant-branding.json";
import { renderableBrand, type StoredBrand } from "@/lib/partner-brand";

export type PublicTenantBranding = { name: string | null; url: string | null; email: string | null };
export const hiddenBranding: PublicTenantBranding = { name: null, url: null, email: null };

/** A partner with no publishable brand never becomes a platform-branded tenant. */
export function resolveTenantBranding(input: {
  enabled: boolean;
  hasPartner: boolean;
  partnerActive: boolean;
  brand: StoredBrand | null;
  legalName?: string | null;
}): PublicTenantBranding {
  if (!input.enabled) return hiddenBranding;
  if (!input.hasPartner) return { ...platform };
  if (!input.partnerActive) return hiddenBranding;
  const brand = renderableBrand(input.brand, { legalName: input.legalName });
  return brand
    ? { name: brand.displayName, url: brand.websiteUrl ?? null, email: null }
    : hiddenBranding;
}
