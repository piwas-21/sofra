import { describe, expect, it } from "vitest";
import {
  PARTNER_BRAND_SITE_PAGE_SIZE,
  assemblePartnerBrandSitesPage,
  eligiblePartnerBrandCursorBoundary,
  parsePartnerBrandSiteCursor,
  partnerBrandSitePageHref,
  partnerBrandSiteQuery,
} from "@/lib/partner-brand-sites-pagination";

const siteRows = (count: number, start = 1) => Array.from({ length: count }, (_, index) => ({
  id: `client-${start + index}`,
  restaurantName: `Restaurant ${start + index}`,
  tenantSlug: "cafe",
}));

describe("partner brand site pagination", () => {
  it("uses a bounded first-page query scoped to the partner and eligible registry slugs", () => {
    const query = partnerBrandSiteQuery("partner-1", ["cafe", "bistro"]);

    expect(query).toEqual({
      where: { partnerId: "partner-1", status: "LIVE", tenantSlug: { in: ["cafe", "bistro"] } },
      orderBy: [{ restaurantName: "asc" }, { id: "asc" }],
      take: PARTNER_BRAND_SITE_PAGE_SIZE + 1,
    });
  });

  it("uses stable keyset boundaries in both directions while retaining a bounded take", () => {
    const boundary = { id: "client-20", restaurantName: "Cafe" };
    const next = partnerBrandSiteQuery("partner-1", ["cafe"], { direction: "after", boundary });
    const previous = partnerBrandSiteQuery("partner-1", ["cafe"], { direction: "before", boundary });

    expect(next.where).toMatchObject({
      partnerId: "partner-1",
      status: "LIVE",
      tenantSlug: { in: ["cafe"] },
      OR: [
        { restaurantName: { gt: "Cafe" } },
        { restaurantName: "Cafe", id: { gt: "client-20" } },
      ],
    });
    expect(next.orderBy).toEqual([{ restaurantName: "asc" }, { id: "asc" }]);
    expect(previous.where).toMatchObject({
      OR: [
        { restaurantName: { lt: "Cafe" } },
        { restaurantName: "Cafe", id: { lt: "client-20" } },
      ],
    });
    expect(previous.orderBy).toEqual([{ restaurantName: "desc" }, { id: "desc" }]);
    expect(next.take).toBe(PARTNER_BRAND_SITE_PAGE_SIZE + 1);
    expect(previous.take).toBe(PARTNER_BRAND_SITE_PAGE_SIZE + 1);
  });

  it("accepts one bounded cursor ID and ignores malformed or conflicting directions", () => {
    expect(parsePartnerBrandSiteCursor({ siteAfter: "client-20" })).toEqual({
      direction: "after",
      clientId: "client-20",
    });
    expect(parsePartnerBrandSiteCursor({ siteBefore: "client-20" })).toEqual({
      direction: "before",
      clientId: "client-20",
    });
    expect(parsePartnerBrandSiteCursor({ siteAfter: ["client-20"] })).toBeNull();
    expect(parsePartnerBrandSiteCursor({ siteAfter: "" })).toBeNull();
    expect(parsePartnerBrandSiteCursor({ siteAfter: "x".repeat(65) })).toBeNull();
    expect(parsePartnerBrandSiteCursor({ siteAfter: "client-20", siteBefore: "client-10" })).toBeNull();
  });

  it("encodes cursor IDs in navigation links", () => {
    const href = partnerBrandSitePageHref("after", "client/20?next=1");
    const previousHref = partnerBrandSitePageHref("before", "client 19");
    expect(new URL(href, "https://sofrapiwas.com").searchParams.get("siteAfter")).toBe("client/20?next=1");
    expect(new URL(previousHref, "https://sofrapiwas.com").searchParams.get("siteBefore")).toBe("client 19");
  });

  it("accepts a cursor boundary only for this partner's active eligible site", () => {
    const candidate = {
      id: "client-20",
      restaurantName: "Cafe",
      partnerId: "partner-1",
      status: "LIVE",
      tenantSlug: "cafe",
    };
    const eligible = new Set(["cafe"]);

    expect(eligiblePartnerBrandCursorBoundary(candidate, "partner-1", eligible)).toEqual({
      id: "client-20",
      restaurantName: "Cafe",
    });
    expect(eligiblePartnerBrandCursorBoundary({ ...candidate, partnerId: "partner-2" }, "partner-1", eligible)).toBeNull();
    expect(eligiblePartnerBrandCursorBoundary({ ...candidate, status: "SUSPENDED" }, "partner-1", eligible)).toBeNull();
    expect(eligiblePartnerBrandCursorBoundary({ ...candidate, tenantSlug: "unknown" }, "partner-1", eligible)).toBeNull();
    expect(eligiblePartnerBrandCursorBoundary(null, "partner-1", eligible)).toBeNull();
  });

  it("assembles bounded next and previous pages with stable navigation cursors", () => {
    const firstPage = assemblePartnerBrandSitesPage(siteRows(PARTNER_BRAND_SITE_PAGE_SIZE + 1), null);
    expect(firstPage.sites).toHaveLength(PARTNER_BRAND_SITE_PAGE_SIZE);
    expect(firstPage.previousHref).toBeNull();
    expect(firstPage.nextHref).toBe("/dashboard/brand?siteAfter=client-20");

    const afterPage = assemblePartnerBrandSitesPage(siteRows(PARTNER_BRAND_SITE_PAGE_SIZE, 21), {
      direction: "after",
      boundary: { id: "client-20", restaurantName: "Restaurant 20" },
    });
    expect(afterPage.previousHref).toBe("/dashboard/brand?siteBefore=client-21");
    expect(afterPage.nextHref).toBeNull();

    const beforePage = assemblePartnerBrandSitesPage(siteRows(PARTNER_BRAND_SITE_PAGE_SIZE + 1, 0).reverse(), {
      direction: "before",
      boundary: { id: "client-21", restaurantName: "Restaurant 21" },
    });
    expect(beforePage.sites[0]?.id).toBe("client-1");
    expect(beforePage.sites.at(-1)?.id).toBe("client-20");
    expect(beforePage.previousHref).toBe("/dashboard/brand?siteBefore=client-1");
    expect(beforePage.nextHref).toBe("/dashboard/brand?siteAfter=client-20");
  });
});
