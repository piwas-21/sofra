// Shape + join logic for the admin onboarding tenant picker. The page (server)
// builds this list from the registry (lib/tenant-registry.ts) joined with the
// TenantBilling rows by slug — the same registry⋈billing join /admin/tenants
// does — and hands it to <OnboardPartnerForm /> (client). Kept as a plain
// module (no "use server"/"use client") so both surfaces import the type + the
// pure predicates, and so the join stays unit-testable.

import type { RegistryTenant } from "@/lib/tenant-registry";

/** A registry tenant flattened for the onboarding picker: the fields the admin
 *  needs to choose one, plus whether it already has a billing anchor. */
export type OnboardTenant = {
  slug: string;
  name: string;
  city?: string;
  currency?: string;
  status: string;
  /** Registry `live_since` (YYYY-MM-DD) when present — pre-fills the date. */
  liveSince?: string;
  /** True when a TenantBilling already exists for this slug (not partner-free). */
  onboarded: boolean;
};

/** Only a partner-free (no billing) AND active tenant can be onboarded. Retired
 *  and already-onboarded tenants are shown for context but never selectable. */
export function isOnboardable(t: OnboardTenant): boolean {
  return t.status === "active" && !t.onboarded;
}

/** Flatten registry tenants into picker rows, stamping the partner-free flag
 *  from the set of slugs that already have a TenantBilling. Input order (the
 *  registry loader sorts by slug) is preserved. */
export function toOnboardTenants(
  tenants: RegistryTenant[],
  onboardedSlugs: Set<string>,
): OnboardTenant[] {
  return tenants.map((t) => ({
    slug: t.slug,
    name: t.name,
    city: t.city,
    currency: t.currency,
    status: t.status,
    liveSince: t.live_since,
    onboarded: onboardedSlugs.has(t.slug),
  }));
}

/** Onboard-form defaults carried over from a direct-restaurant signup lead
 *  (ADR-004), so the founder doesn't re-type the card. Maps to the always-present
 *  onboard inputs; amount/interval/liveSince are founder-set and never inferred.
 *  `signupId` rides a hidden field so a successful onboard can close the lead. */
export type OnboardPrefill = {
  signupId: string;
  name: string;
  email: string;
  restaurantName: string;
  /** Registry-grammar slug when the lead supplied one, else "" (optional field). */
  tenantSlug: string;
};

/** The signup fields the prefill reads — a structural subset of the Prisma row. */
type SignupPrefillSource = {
  id: string;
  contactName: string;
  email: string;
  restaurantName: string;
  desiredSlug: string | null;
};

/** Build onboard-form defaults from a signup lead. The onboard payer is the
 *  restaurant's own contact (a direct signup has no reseller partner), so
 *  `name` is the contactName. `desiredSlug` is optional on intake → "". */
export function toOnboardPrefill(signup: SignupPrefillSource): OnboardPrefill {
  return {
    signupId: signup.id,
    name: signup.contactName,
    email: signup.email,
    restaurantName: signup.restaurantName,
    tenantSlug: signup.desiredSlug ?? "",
  };
}
