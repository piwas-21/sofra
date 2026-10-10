import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ registry: vi.fn(), preference: vi.fn(), clients: vi.fn(), billing: vi.fn() }));
vi.mock("@/lib/tenant-registry", () => ({ loadTenantRegistry: mocks.registry }));
vi.mock("@/lib/db", () => ({ db: { tenantBranding: { findUnique: mocks.preference },
  client: { findMany: mocks.clients }, tenantBilling: { findUnique: mocks.billing } } }));
const { publicTenantBranding } = await import("@/lib/tenant-branding");
const brand = { displayName: "Studio", websiteUrl: "https://studio.example.test", publishToTenants: true };
const client = { id: "client", tenantSlug: "tenant", status: "LIVE", partnerId: "partner",
  billing: { tenantSlug: "tenant" }, partner: { status: "ACTIVE", role: "PARTNER", brand, billingIdentity: null } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.registry.mockResolvedValue({ ok: true, tenants: [{ slug: "tenant", status: "active" }] });
  mocks.preference.mockResolvedValue(null); mocks.clients.mockResolvedValue([client]);
  mocks.billing.mockResolvedValue({ clientId: "client", payerUserId: null });
});
describe("runtime lookup", () => {
  it("reflects subsequent partner changes without copying values to tenant preferences", async () => {
    expect(await publicTenantBranding("tenant")).toMatchObject({ name: "Studio", email: null });
    mocks.clients.mockResolvedValue([{ ...client, partner: { ...client.partner, brand: { ...brand, displayName: "New Studio" } } }]);
    expect(await publicTenantBranding("tenant")).toMatchObject({ name: "New Studio" });
  });
  it("reflects withdrawal immediately", async () => {
    mocks.clients.mockResolvedValue([{ ...client, partner: { ...client.partner, brand: { ...brand, publishToTenants: false } } }]);
    expect(await publicTenantBranding("tenant")).toEqual({ name: null, url: null, email: null });
  });
  it("serves platform branding for tenants with no partner", async () => {
    mocks.clients.mockResolvedValue([]); mocks.billing.mockResolvedValue(null);
    expect(await publicTenantBranding("tenant")).toMatchObject({ name: "Sofra", email: "sofra@piwas.nl" });
  });
  it.each([{ enabled: false }])("honours per-site database opt-out %o", async (preference) => {
    mocks.preference.mockResolvedValue(preference);
    expect(await publicTenantBranding("tenant")).toEqual({ name: null, url: null, email: null });
  });
  it("honours existing restaurant opt-out", async () => {
    mocks.registry.mockResolvedValue({ ok: true, tenants: [{ slug: "tenant", status: "active", partner_attribution: false }] });
    expect(await publicTenantBranding("tenant")).toMatchObject({ name: null });
  });
  it.each([{ clients: [client, client] }, { clients: [{ ...client, tenantSlug: "other" }] }, { clients: [{ ...client, status: "CHURNED" }] }])
    ("suppresses ambiguous/stale mapping %o", async ({ clients }) => {
      mocks.clients.mockResolvedValue(clients); expect(await publicTenantBranding("tenant")).toMatchObject({ name: null });
    });
  it("does not disguise an orphan legacy partner credit as Sofra", async () => {
    mocks.clients.mockResolvedValue([]); mocks.billing.mockResolvedValue(null);
    mocks.registry.mockResolvedValue({ ok: true, tenants: [{ slug: "tenant", status: "active", partner_name: "Legacy" }] });
    expect(await publicTenantBranding("tenant")).toMatchObject({ name: null });
  });
  it("unknown tenants are not public", async () => { expect(await publicTenantBranding("unknown")).toBeNull(); });
  it("an unreadable registry is a failure, not a platform fallback", async () => {
    mocks.registry.mockResolvedValue({ ok: false });
    await expect(publicTenantBranding("tenant")).rejects.toThrow("branding registry unavailable");
  });
});
