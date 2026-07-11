import { describe, expect, it } from "vitest";
import { SITE_URL, marketingPageMetadata, pageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";

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
      siteName: "Sofra",
    });
    expect(meta.alternates?.canonical).toBe("/de/case/rumi");
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });
});

describe("SITE_URL", () => {
  it("is an absolute https URL with no trailing slash", () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/);
  });
});
