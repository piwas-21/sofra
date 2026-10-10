import { fixtureUrl } from "../helpers/branding-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("@/lib/tenant-branding", () => ({ publicTenantBranding: mocks.lookup }));
const { GET } = await import("@/app/api/public/tenant-branding/[slug]/route");
const request = (slug = "tenant", etag?: string) => GET(
  new Request(`${fixtureUrl("control")}/api/public/tenant-branding/${slug}`,
    { headers: etag ? { "if-none-match": etag } : {} }), { params: Promise.resolve({ slug }) });
beforeEach(() => { vi.resetAllMocks(); mocks.lookup.mockResolvedValue({ name: "Public", url: null, email: null }); });
describe("public branding route", () => {
  it("serves only the public projection and an ETag", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Public", url: null, email: null });
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
  });
  it("returns 304 only for the current representation", async () => {
    const response = await request(); const etag = response.headers.get("etag")!;
    expect((await request("tenant", etag)).status).toBe(304);
    mocks.lookup.mockResolvedValue({ name: null, url: null, email: null });
    expect((await request("tenant", etag)).status).toBe(200);
  });
  it.each(["bad/slug", "", "Tenant"]) ("invalid slug %s is rejected before DB lookup", async (slug) => {
    expect((await request(slug)).status).toBe(404); expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("unknown/inactive tenant returns 404", async () => {
    mocks.lookup.mockResolvedValue(null); expect((await request()).status).toBe(404);
  });
  it("outage returns a non-cacheable 503, not an empty authoritative brand", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.lookup.mockRejectedValue(new Error("unavailable"));
    const response = await request(); expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store"); error.mockRestore();
  });
});
