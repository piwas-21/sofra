import { fixtureUrl, fixtureEmail, platformFixture } from "../helpers/branding-fixture";
import { describe, expect, it } from "vitest";
import { hiddenBranding, resolveTenantBranding } from "@/lib/tenant-branding-policy";

const brand = { displayName: "Public Studio", websiteUrl: fixtureUrl("studio"), publishToTenants: true,
  tagline: "Private tagline", email: fixtureEmail("private", "studio"), phone: "private",
  addressLine1: "private", postalCode: "private", city: "private", countryCode: "NL" };
const input = { enabled: true, hasPartner: true, partnerActive: true, brand, platform: { name: "Sofra", url: platformFixture.url, email: platformFixture.email }, legalName: "Private Person" };

describe("runtime branding publication", () => {
  it("defaults only an unpartnered tenant to the explicitly configured platform", () => {
    expect(resolveTenantBranding({ ...input, hasPartner: false, brand: null })).toEqual({
      name: "Sofra", url: platformFixture.url, email: platformFixture.email,
    });
  });
  it("projects exactly name and website from a partner", () => {
    expect(resolveTenantBranding(input)).toEqual({ name: "Public Studio", url: fixtureUrl("studio"), email: null });
  });
  it.each([
    { enabled: false }, { partnerActive: false }, { brand: null },
    { brand: { ...brand, publishToTenants: false } }, { legalName: "  public  STUDIO " },
  ])("suppresses publication without falling back to Sofra: %o", (override) => {
    expect(resolveTenantBranding({ ...input, ...override })).toEqual(hiddenBranding);
  });
  it("a platform default also respects the restaurant's opt-out", () => {
    expect(resolveTenantBranding({ ...input, hasPartner: false, enabled: false })).toEqual(hiddenBranding);
  });
  it("withdraws only an invalid website while retaining the approved name", () => {
    expect(resolveTenantBranding({ ...input, brand: { ...brand, websiteUrl: "javascript:alert(1)" } }))
      .toEqual({ name: "Public Studio", url: null, email: null });
  });
});
