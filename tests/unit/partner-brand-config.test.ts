import { describe, expect, it } from "vitest";
import {
  PARTNER_BRAND_CONFIG_ENV,
  partnerBrandRuntimeConfig,
} from "@/lib/partner-brand-config";

describe("partner brand runtime configuration", () => {
  it("uses the reviewed safe defaults when optional overrides are unset", () => {
    expect(partnerBrandRuntimeConfig({})).toEqual({
      applyMaxAttempts: 12,
      applyWindowMs: 900000,
      sitePageSize: 20,
    });
  });

  it("accepts positive integer overrides within each configured bound", () => {
    expect(partnerBrandRuntimeConfig({
      [PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts]: "25",
      [PARTNER_BRAND_CONFIG_ENV.applyWindowMs]: "60000",
      [PARTNER_BRAND_CONFIG_ENV.sitePageSize]: "40",
    })).toEqual({ applyMaxAttempts: 25, applyWindowMs: 60000, sitePageSize: 40 });
  });

  it.each([
    [PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts, "0"],
    [PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts, ""],
    [PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts, "NaN"],
    [PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts, "101"],
    [PARTNER_BRAND_CONFIG_ENV.applyWindowMs, "9007199254740992"],
    [PARTNER_BRAND_CONFIG_ENV.applyWindowMs, "86400001"],
    [PARTNER_BRAND_CONFIG_ENV.sitePageSize, "0"],
    [PARTNER_BRAND_CONFIG_ENV.sitePageSize, "101"],
  ])("rejects invalid or out-of-bounds %s=%s", (variable, value) => {
    expect(() => partnerBrandRuntimeConfig({ [variable]: value })).toThrow();
  });
});
