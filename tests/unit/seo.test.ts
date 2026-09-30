import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_URL, marketingPageMetadata, pageAlternates } from "@/lib/seo";
import { getPublishedMarketingRoutePaths } from "@/lib/marketing-routes";
import { routing } from "@/i18n/routing";

const LEGAL_IDENTITY_ENV = [
  "SOFRA_LEGAL_NAME",
  "SOFRA_LEGAL_ADDRESS",
  "SOFRA_LEGAL_POSTAL",
  "SOFRA_LEGAL_CITY",
  "SOFRA_LEGAL_COUNTRY",
  "SOFRA_KVK",
  "SOFRA_VAT_NUMBER",
  "SOFRA_LEGAL_EMAIL",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("pageAlternates", () => {
  it("builds canonical + hreflang for a content path", () => {
    const alt = pageAlternates("fr", "/changelog");
    expect(alt.canonical).toBe("/fr/changelog");
    expect(alt.languages).toMatchObject({
      en: "/en/changelog",
      ar: "/ar/changelog",
      "x-default": `/${routing.defaultLocale}/changelog`,
    });
  });

  it("covers every routing locale plus x-default", () => {
    const alt = pageAlternates("en", "");
    expect(Object.keys(alt.languages ?? {})).toHaveLength(
      routing.locales.length + 1,
    );
    expect(alt.canonical).toBe("/en");
  });
});

describe("marketingPageMetadata", () => {
  it("mirrors title/description into openGraph and sets alternates", () => {
    const meta = marketingPageMetadata({
      locale: "de",
      path: "/case/rumi",
      title: "T",
      description: "D",
    });
    expect(meta.title).toBe("T");
    expect(meta.openGraph).toMatchObject({
      title: "T",
      description: "D",
      locale: "de",
      siteName: "SofraPiwas",
    });
    expect(meta.alternates?.canonical).toBe("/de/case/rumi");
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });

  it("keeps the legal route out of indexing until the complete seller identity exists", () => {
    for (const key of LEGAL_IDENTITY_ENV) vi.stubEnv(key, "");
    const meta = marketingPageMetadata({
      locale: "en",
      path: "/legal",
      title: "Legal",
      description: "Legal details",
    });

    expect(meta.robots).toMatchObject({ index: false, follow: true });
    expect(meta.alternates?.languages).toBeUndefined();
    expect(getPublishedMarketingRoutePaths()).not.toContain("/legal");
  });

  it("publishes legal indexing and reciprocal locale alternates with complete identity", () => {
    const identity = {
      SOFRA_LEGAL_NAME: "Example Company B.V.",
      SOFRA_LEGAL_ADDRESS: "Example Street 1",
      SOFRA_LEGAL_POSTAL: "1015 CJ",
      SOFRA_LEGAL_CITY: "Amsterdam",
      SOFRA_LEGAL_COUNTRY: "NL",
      SOFRA_KVK: "12345678",
      SOFRA_VAT_NUMBER: "NL123456789B01",
      SOFRA_LEGAL_EMAIL: "legal@example.test",
    } as const;
    for (const [key, value] of Object.entries(identity)) vi.stubEnv(key, value);

    const meta = marketingPageMetadata({
      locale: "fr",
      path: "/legal",
      title: "Mentions légales",
      description: "Identité légale",
    });

    expect(meta.robots).toMatchObject({ index: true, follow: true });
    expect(meta.alternates?.languages).toMatchObject({
      en: "/en/legal",
      ar: "/ar/legal",
      "x-default": "/en/legal",
    });
    expect(getPublishedMarketingRoutePaths()).toContain("/legal");
  });

  it("keeps noncanonical metadata noindex and omits a staging sitemap", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.sofrapiwas.com");
    vi.resetModules();
    const { marketingPageMetadata, pageAlternates } = await import("@/lib/seo");
    const meta = marketingPageMetadata({
      locale: "fr",
      path: "/compare/alternatives",
      title: "Alternatives",
      description: "Compare restaurant tools",
    });

    expect(meta.robots).toMatchObject({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("/fr/compare/alternatives");
    expect(meta.alternates?.languages).toBeUndefined();
    expect(pageAlternates("en", "").languages).toBeUndefined();
    expect(() => pageAlternates("en", "/untracked-route")).toThrow(
      "Add /untracked-route to the public marketing route inventory first.",
    );

    const { default: sitemap } = await import("@/app/sitemap");
    expect(sitemap()).toEqual([]);
  });
});

describe("SITE_URL", () => {
  it("is an absolute https URL with no trailing slash", () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/);
  });
});
