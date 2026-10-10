import { afterEach, describe, expect, it, vi } from "vitest";
import { platformTenantBranding } from "@/lib/tenant-branding-config";
afterEach(() => vi.unstubAllEnvs());
describe("platform runtime configuration", () => {
  it("reads the configured public company fields", () => {
    vi.stubEnv("SOFRA_BRAND_NAME", "Platform");
    vi.stubEnv("SOFRA_BRAND_URL", "https://platform.example.test");
    vi.stubEnv("SOFRA_BRAND_EMAIL", "hello@platform.example.test");
    expect(platformTenantBranding()).toEqual({ name: "Platform", url: "https://platform.example.test", email: "hello@platform.example.test" });
  });
  it("refuses missing configuration instead of inventing public identity", () => {
    vi.stubEnv("SOFRA_BRAND_NAME", ""); vi.stubEnv("SOFRA_BRAND_URL", ""); vi.stubEnv("SOFRA_BRAND_EMAIL", "");
    expect(() => platformTenantBranding()).toThrow();
  });
});
