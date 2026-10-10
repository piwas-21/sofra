import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePartner: vi.fn(), client: vi.fn(), clients: vi.fn(), billing: vi.fn(),
  upsert: vi.fn(), registry: vi.fn(), audit: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/rbac", () => ({ requirePartner: mocks.requirePartner }));
vi.mock("@/lib/db", () => ({ db: {
  client: { findFirst: mocks.client, findMany: mocks.clients },
  tenantBilling: { findUnique: mocks.billing }, tenantBranding: { upsert: mocks.upsert },
} }));
vi.mock("@/lib/tenant-registry", () => ({ loadTenantRegistry: mocks.registry }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { applyPartnerBrandAction } = await import("@/lib/actions/partner-brand-apply-actions");
const client = { id: "client", partnerId: "partner", tenantSlug: "tenant", status: "LIVE" };
const form = (enabled = "true") => {
  const data = new FormData(); data.set("clientId", "client"); data.set("enabled", enabled);
  data.set("tenantSlug", "victim"); data.set("partnerId", "victim"); return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requirePartner.mockResolvedValue({ id: "partner" });
  mocks.client.mockResolvedValue(client);
  mocks.clients.mockResolvedValue([{ ...client, billing: { tenantSlug: "tenant" } }]);
  mocks.billing.mockResolvedValue({ clientId: "client", payerUserId: null });
  mocks.registry.mockResolvedValue({ ok: true, tenants: [{ slug: "tenant", status: "active" }] });
  mocks.rateLimit.mockReturnValue(true);
});

describe("database preference application", () => {
  it("writes only the verified session-owned tenant and requires no deployment", async () => {
    expect(await applyPartnerBrandAction({}, form())).toEqual({ ok: true, outcome: "applied", enabled: true, optedOut: false });
    expect(mocks.client).toHaveBeenCalledWith({ where: { id: "client", partnerId: "partner" } });
    expect(mocks.upsert).toHaveBeenCalledWith({ where: { tenantSlug: "tenant" },
      create: { tenantSlug: "tenant", enabled: true }, update: { enabled: true } });
  });
  it("can hide credit on one site", async () => {
    await applyPartnerBrandAction({}, form("false"));
    expect(mocks.upsert.mock.calls[0][0].update).toEqual({ enabled: false });
  });
  it("reports the restaurant opt-out even when the partner requests show", async () => {
    mocks.registry.mockResolvedValue({ ok: true, tenants: [{ slug: "tenant", status: "active", partner_attribution: false }] });
    expect(await applyPartnerBrandAction({}, form())).toMatchObject({ optedOut: true });
  });
  it("rejects cross-partner client access", async () => {
    mocks.client.mockResolvedValue(null);
    expect(await applyPartnerBrandAction({}, form())).toEqual({ error: "clientNotFound" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each([{ rows: [] }, { rows: [client, client] }])("rejects ambiguous mapping %o", async ({ rows }) => {
    mocks.clients.mockResolvedValue(rows);
    expect(await applyPartnerBrandAction({}, form())).toEqual({ error: "partnerBrandMappingAmbiguous" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects an owner billing mismatch", async () => {
    mocks.billing.mockResolvedValue({ clientId: null, payerUserId: "owner" });
    expect(await applyPartnerBrandAction({}, form())).toEqual({ error: "partnerBrandMappingAmbiguous" });
  });
  it.each([ { ok: false }, { ok: true, tenants: [{ slug: "tenant", status: "retired" }] } ])
    ("rejects unavailable/inactive registry %o", async (registry) => {
      mocks.registry.mockResolvedValue(registry);
      expect(await applyPartnerBrandAction({}, form())).toEqual({ error: "runtimeBrandApplyFailed" });
      expect(mocks.upsert).not.toHaveBeenCalled();
    });
  it("enforces per-partner rate limit", async () => {
    mocks.rateLimit.mockReturnValue(false);
    expect(await applyPartnerBrandAction({}, form())).toEqual({ error: "tooManyAttempts" });
  });
  it("requires the partner role before mutation", async () => {
    mocks.requirePartner.mockRejectedValue(new Error("forbidden"));
    await expect(applyPartnerBrandAction({}, form())).rejects.toThrow("forbidden");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
