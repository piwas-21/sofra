import { describe, expect, it } from "vitest";
import type { RegistryTenant } from "@/lib/tenant-registry";
import { isOnboardable, toOnboardTenants } from "@/lib/onboard-tenants";
import type { OnboardTenant } from "@/lib/onboard-tenants";

// Minimal registry tenant — only the fields toOnboardTenants reads matter; the
// rest satisfy the type.
const reg = (over: Partial<RegistryTenant> & { slug: string }): RegistryTenant => ({
  name: `${over.slug} Restaurant`,
  status: "active",
  managed: "scripts",
  box: "staging",
  domain: `${over.slug}.sofrapiwas.com`,
  domain_mode: "subdomain",
  db: `tenant_${over.slug}`,
  languages: [],
  modules: [],
  ...over,
});

const onb = (over: Partial<OnboardTenant> & { slug: string }): OnboardTenant => ({
  name: over.slug,
  status: "active",
  onboarded: false,
  ...over,
});

describe("toOnboardTenants", () => {
  it("stamps onboarded from the billing-slug set and maps context fields", () => {
    const tenants = [
      reg({ slug: "rumi", name: "RUMI", city: "Geneva", currency: "CHF", live_since: "2026-06-29" }),
      reg({ slug: "demo", status: "retired" }),
    ];
    const result = toOnboardTenants(tenants, new Set(["rumi"]));

    expect(result).toEqual([
      {
        slug: "rumi",
        name: "RUMI",
        city: "Geneva",
        currency: "CHF",
        status: "active",
        liveSince: "2026-06-29",
        onboarded: true,
      },
      {
        slug: "demo",
        name: "demo Restaurant",
        city: undefined,
        currency: undefined,
        status: "retired",
        liveSince: undefined,
        onboarded: false,
      },
    ]);
  });

  it("preserves input order and marks all partner-free when the set is empty", () => {
    const result = toOnboardTenants([reg({ slug: "a" }), reg({ slug: "b" })], new Set());
    expect(result.map((t) => t.slug)).toEqual(["a", "b"]);
    expect(result.every((t) => !t.onboarded)).toBe(true);
  });
});

describe("isOnboardable", () => {
  it("is true only for active, partner-free tenants", () => {
    expect(isOnboardable(onb({ slug: "ok" }))).toBe(true);
    expect(isOnboardable(onb({ slug: "taken", onboarded: true }))).toBe(false);
    expect(isOnboardable(onb({ slug: "retired", status: "retired" }))).toBe(false);
    expect(isOnboardable(onb({ slug: "prov", status: "provisioning" }))).toBe(false);
    // onboarded AND retired — still not onboardable
    expect(isOnboardable(onb({ slug: "gone", status: "retired", onboarded: true }))).toBe(false);
  });
});
