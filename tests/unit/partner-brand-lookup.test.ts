import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const mocks = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  brandFindUnique: vi.fn(),
  identityFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    client: { findFirst: mocks.clientFindFirst },
    partnerBrand: { findUnique: mocks.brandFindUnique },
    billingIdentity: { findUnique: mocks.identityFindUnique },
  },
}));

const { tenantPartnerBrand } = await import("@/lib/partner-brand-lookup");
const { buildTenantRegistryEntry } = await import("@/lib/provisioning-registry");

const savedBrand = {
  displayName: "Public Partner",
  tagline: "Private tagline",
  websiteUrl: "https://partner.example",
  email: "private@example.com",
  phone: "+31 20 000 0000",
  addressLine1: "Private Street",
  postalCode: "1000",
  city: "Amsterdam",
  countryCode: "NL",
  publishToTenants: true,
};

const tenant = {
  slug: "cafe-demo",
  name: "Cafe Demo",
  adminEmail: "owner@example.com",
  template: "craft" as const,
  currency: "CHF",
  languages: ["en"],
  modules: ["core"],
};

beforeEach(() => {
  mocks.clientFindFirst.mockReset().mockResolvedValue({ partnerId: "partner-1" });
  mocks.brandFindUnique.mockReset().mockResolvedValue(savedBrand);
  mocks.identityFindUnique.mockReset().mockResolvedValue({ legalName: "Private Legal Name" });
});

describe("tenantPartnerBrand new-tenant provisioning lookup", () => {
  it("passes only the opted-in public projection into a new registry entry", async () => {
    const brand = await tenantPartnerBrand(tenant.slug);
    const { entry } = buildTenantRegistryEntry({ ...tenant, partnerBrand: brand });
    const parsed = parse(entry) as Record<string, Record<string, unknown>>;

    expect(brand).toEqual({ displayName: "Public Partner", websiteUrl: "https://partner.example" });
    expect(parsed[tenant.slug]).toMatchObject({
      partner_name: "Public Partner",
      partner_url: "https://partner.example",
    });
    expect(entry).not.toContain("private@example.com");
    expect(entry).not.toContain("Private Street");
    expect(entry).not.toContain("Private Legal Name");
  });

  it("keeps a saved brand out of a new registry entry until the partner opts in", async () => {
    mocks.brandFindUnique.mockResolvedValue({ ...savedBrand, publishToTenants: false });

    const brand = await tenantPartnerBrand(tenant.slug);
    const { entry } = buildTenantRegistryEntry({ ...tenant, partnerBrand: brand });

    expect(brand).toBeUndefined();
    expect(entry).not.toContain("partner_name:");
    expect(entry).not.toContain("partner_url:");
  });

  it("refuses a legal-name echo before a new tenant receives the credit", async () => {
    mocks.brandFindUnique.mockResolvedValue({ ...savedBrand, displayName: "Private Legal Name" });

    const brand = await tenantPartnerBrand(tenant.slug);
    const { entry } = buildTenantRegistryEntry({ ...tenant, partnerBrand: brand });

    expect(brand).toBeUndefined();
    expect(entry).not.toContain("Private Legal Name");
  });

  it("returns no credit when there is no partner-linked client", async () => {
    mocks.clientFindFirst.mockResolvedValue(null);

    await expect(tenantPartnerBrand(tenant.slug)).resolves.toBeUndefined();
    expect(mocks.brandFindUnique).not.toHaveBeenCalled();
    expect(mocks.identityFindUnique).not.toHaveBeenCalled();
  });
});
