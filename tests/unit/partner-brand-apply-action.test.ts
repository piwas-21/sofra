import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  partner: { id: "partner-1", email: "private-contact@partner.test", name: "Private Contact", role: "PARTNER" as const },
  requirePartner: vi.fn(),
  clientFindFirst: vi.fn(),
  clientFindMany: vi.fn(),
  billingFindUnique: vi.fn(),
  brandFindUnique: vi.fn(),
  identityFindUnique: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
  openProposal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    client: { findFirst: mocks.clientFindFirst, findMany: mocks.clientFindMany },
    tenantBilling: { findUnique: mocks.billingFindUnique },
    partnerBrand: { findUnique: mocks.brandFindUnique },
    billingIdentity: { findUnique: mocks.identityFindUnique },
  },
}));
vi.mock("@/lib/rbac", () => ({ requirePartner: mocks.requirePartner }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/partner-brand-registry-pr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/partner-brand-registry-pr")>();
  return { ...actual, openPartnerBrandRegistryPr: mocks.openProposal };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { applyPartnerBrandAction } = await import("@/lib/actions/partner-brand-apply-actions");
const { ProvisioningNotConfiguredError } = await import("@/lib/provisioning");
const { PARTNER_BRAND_CONFIG_ENV, partnerBrandRuntimeConfig } = await import("@/lib/partner-brand-config");

const PRIVATE_CONTACT_EMAIL = "private-contact@partner.test";
const PUBLIC_BRAND_URL = "https://studio.partner.test";
const PULL_REQUEST_FIXTURE_BASE = "https://github.test/piwas-21/restaurant-app-deploy/pull";
const pullRequestUrl = (number: number) => `${PULL_REQUEST_FIXTURE_BASE}/${number}`;

const client = {
  id: "client-mine",
  partnerId: "partner-1",
  tenantSlug: "zeta",
  status: "LIVE",
};
const billingMapping = { clientId: "client-mine", payerUserId: null };
const relatedClients = [
  { id: "client-mine", partnerId: "partner-1", tenantSlug: "zeta", billing: { tenantSlug: "zeta" } },
];
const savedBrand = {
  displayName: "Public Studio",
  tagline: "Private unused field",
  websiteUrl: PUBLIC_BRAND_URL,
  email: PRIVATE_CONTACT_EMAIL,
  phone: "+31 20 000 0000",
  addressLine1: "Private street 1",
  postalCode: "1000",
  city: "Amsterdam",
  countryCode: "NL",
  publishToTenants: true,
};

const form = (values: Record<string, string>) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.append(key, value);
  return result;
};
const submit = (values: Record<string, string>) => applyPartnerBrandAction({}, form(values));

beforeEach(() => {
  mocks.requirePartner.mockReset().mockResolvedValue(mocks.partner);
  mocks.clientFindFirst.mockReset().mockImplementation(async ({ where }: { where: { id: string; partnerId: string } }) =>
    where.id === client.id && where.partnerId === client.partnerId
      ? { ...client }
      : where.id === "client-other" && where.partnerId === "partner-2"
        ? { id: "client-other", partnerId: "partner-2", tenantSlug: "other", status: "LIVE" }
        : null,
  );
  mocks.clientFindMany.mockReset().mockResolvedValue(relatedClients);
  mocks.billingFindUnique.mockReset().mockResolvedValue(billingMapping);
  mocks.brandFindUnique.mockReset().mockResolvedValue(savedBrand);
  mocks.identityFindUnique.mockReset().mockResolvedValue({ legalName: "Private Legal Name" });
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.rateLimit.mockReset().mockReturnValue(true);
  mocks.openProposal.mockReset().mockResolvedValue({ kind: "opened", prUrl: pullRequestUrl(42), optedOut: false });
});

describe("applyPartnerBrandAction authorization and projection", () => {
  it("uses the session and client ID, ignores a posted tenant slug, and passes only the public projection", async () => {
    const state = await submit({ clientId: "client-mine", tenantSlug: "other" });

    expect(state).toEqual({
      ok: true,
      outcome: "proposed",
      optedOut: false,
      prUrl: pullRequestUrl(42),
    });
    const config = partnerBrandRuntimeConfig({});
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "partner-brand-apply:partner-1",
      config.applyMaxAttempts,
      config.applyWindowMs,
    );
    expect(mocks.clientFindFirst).toHaveBeenCalledWith({ where: { id: "client-mine", partnerId: "partner-1" } });
    expect(mocks.clientFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(mocks.openProposal).toHaveBeenCalledWith("partner-1", "zeta", {
      displayName: "Public Studio",
      websiteUrl: PUBLIC_BRAND_URL,
    });
    expect(JSON.stringify(mocks.openProposal.mock.calls)).not.toContain("Private Legal Name");
    expect(JSON.stringify(mocks.openProposal.mock.calls)).not.toContain(PRIVATE_CONTACT_EMAIL);
  });

  it("fails closed on invalid runtime limits before proposal or throttle access", async () => {
    const previous = process.env[PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts];
    process.env[PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts] = "0";
    try {
      expect(await submit({ clientId: "client-mine" })).toEqual({ error: "partnerBrandApplyFailed" });
      expect(mocks.rateLimit).not.toHaveBeenCalled();
      expect(mocks.clientFindFirst).not.toHaveBeenCalled();
      expect(mocks.openProposal).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env[PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts];
      else process.env[PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts] = previous;
    }
  });

  it("does not let a cross-partner client id or forged slug reach registry proposal", async () => {
    const state = await submit({ clientId: "client-other", tenantSlug: "zeta" });

    expect(state).toEqual({ error: "clientNotFound" });
    expect(mocks.clientFindMany).not.toHaveBeenCalled();
    expect(mocks.openProposal).not.toHaveBeenCalled();
  });

  it("requires partner authorization before looking up a posted client ID", async () => {
    mocks.requirePartner.mockRejectedValue(new Error("unauthorized"));

    await expect(submit({ clientId: "client-mine" })).rejects.toThrow("unauthorized");
    expect(mocks.clientFindFirst).not.toHaveBeenCalled();
    expect(mocks.clientFindMany).not.toHaveBeenCalled();
    expect(mocks.openProposal).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous client or direct-owner billing mapping", async () => {
    mocks.clientFindMany.mockResolvedValue([
      ...relatedClients,
      { id: "client-second", partnerId: "partner-1", tenantSlug: null, billing: { tenantSlug: "zeta" } },
    ]);
    expect(await submit({ clientId: "client-mine" })).toEqual({ error: "partnerBrandMappingAmbiguous" });
    expect(mocks.openProposal).not.toHaveBeenCalled();

    mocks.clientFindMany.mockResolvedValue(relatedClients);
    mocks.billingFindUnique.mockResolvedValue({ clientId: null, payerUserId: "owner-1" });
    expect(await submit({ clientId: "client-mine" })).toEqual({ error: "partnerBrandMappingAmbiguous" });
    expect(mocks.openProposal).not.toHaveBeenCalled();
  });

  it("requires a live provisioned client before checking mappings", async () => {
    mocks.clientFindFirst.mockResolvedValue({ ...client, status: "ONBOARDING", tenantSlug: null });
    expect(await submit({ clientId: "client-mine" })).toEqual({ error: "clientNotProvisioned" });
    expect(mocks.clientFindMany).not.toHaveBeenCalled();
    expect(mocks.openProposal).not.toHaveBeenCalled();
  });

  it("uses the safe null projection to remove/unpublish, and refuses a legal-name echo", async () => {
    mocks.brandFindUnique.mockResolvedValue({ ...savedBrand, publishToTenants: false });
    expect(await submit({ clientId: "client-mine" })).toMatchObject({ ok: true });
    expect(mocks.openProposal).toHaveBeenLastCalledWith("partner-1", "zeta", null);

    mocks.brandFindUnique.mockResolvedValue({ ...savedBrand, displayName: "Private Legal Name" });
    expect(await submit({ clientId: "client-mine" })).toMatchObject({ ok: true });
    expect(mocks.openProposal).toHaveBeenLastCalledWith("partner-1", "zeta", null);
  });

  it("returns a clear unavailable error when the GitHub proposal token is missing", async () => {
    mocks.openProposal.mockRejectedValue(new ProvisioningNotConfiguredError());

    expect(await submit({ clientId: "client-mine" })).toEqual({ error: "partnerBrandProposalUnavailable" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("preserves a pending proposal URL instead of claiming publication", async () => {
    mocks.openProposal.mockResolvedValue({ kind: "pending", prUrl: pullRequestUrl(9), optedOut: false });

    expect(await submit({ clientId: "client-mine" })).toEqual({
      ok: true,
      outcome: "pending",
      optedOut: false,
      prUrl: pullRequestUrl(9),
    });
  });

  it("returns a conflicting proposal link when saved details differ from the open PR", async () => {
    const { PartnerBrandProposalConflictError } = await import("@/lib/partner-brand-registry-pr");
    mocks.openProposal.mockRejectedValue(
      new PartnerBrandProposalConflictError("different proposal", pullRequestUrl(50)),
    );

    expect(await submit({ clientId: "client-mine" })).toEqual({
      error: "partnerBrandProposalConflict",
      prUrl: pullRequestUrl(50),
    });
  });
});
