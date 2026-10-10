import { describe, expect, it } from "vitest";
import {
  assemblePartnerBrandSitesPage,
  eligiblePartnerBrandCursorBoundary,
  parsePartnerBrandSiteCursor,
  partnerBrandSitePageHref,
  partnerBrandSiteQuery,
} from "@/lib/partner-brand-sites-pagination";
import { partnerBrandRuntimeConfig } from "@/lib/partner-brand-config";

const DEFAULT_PAGE_SIZE = partnerBrandRuntimeConfig({}).sitePageSize;
const FIXTURE_ORIGIN = "https://pagination.test";

const siteRows = (count: number, start = 1) => Array.from({ length: count }, (_, index) => ({
  id: `client-${start + index}`,
  restaurantName: `Restaurant ${start + index}`,
  tenantSlug: "cafe",
}));

describe("partner brand site pagination", () => {
  it("uses a bounded first-page query scoped to the partner and eligible registry slugs", () => {
    const query = partnerBrandSiteQuery("partner-1", ["cafe", "bistro"], DEFAULT_PAGE_SIZE);

    expect(query).toEqual({
      where: { partnerId: "partner-1", status: "LIVE", tenantSlug: { in: ["cafe", "bistro"] } },
      orderBy: [{ restaurantName: "asc" }, { id: "asc" }],
      take: DEFAULT_PAGE_SIZE + 1,
    });
  });

  it("uses stable keyset boundaries in both directions while retaining a bounded take", () => {
    const boundary = { id: "client-20", restaurantName: "Cafe" };
    const next = partnerBrandSiteQuery("partner-1", ["cafe"], DEFAULT_PAGE_SIZE, { direction: "after", boundary });
    const previous = partnerBrandSiteQuery("partner-1", ["cafe"], DEFAULT_PAGE_SIZE, { direction: "before", boundary });

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
    expect(next.take).toBe(DEFAULT_PAGE_SIZE + 1);
    expect(previous.take).toBe(DEFAULT_PAGE_SIZE + 1);
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
    expect(new URL(href, FIXTURE_ORIGIN).searchParams.get("siteAfter")).toBe("client/20?next=1");
    expect(new URL(previousHref, FIXTURE_ORIGIN).searchParams.get("siteBefore")).toBe("client 19");
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
    const firstPage = assemblePartnerBrandSitesPage(siteRows(DEFAULT_PAGE_SIZE + 1), null, DEFAULT_PAGE_SIZE);
    expect(firstPage.sites).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(firstPage.previousHref).toBeNull();
    expect(firstPage.nextHref).toBe(`/dashboard/brand?siteAfter=client-${DEFAULT_PAGE_SIZE}`);

    const afterPage = assemblePartnerBrandSitesPage(siteRows(DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE + 1), {
      direction: "after",
      boundary: { id: `client-${DEFAULT_PAGE_SIZE}`, restaurantName: `Restaurant ${DEFAULT_PAGE_SIZE}` },
    }, DEFAULT_PAGE_SIZE);
    expect(afterPage.previousHref).toBe(`/dashboard/brand?siteBefore=client-${DEFAULT_PAGE_SIZE + 1}`);
    expect(afterPage.nextHref).toBeNull();

    const beforePage = assemblePartnerBrandSitesPage(siteRows(DEFAULT_PAGE_SIZE + 1, 0).reverse(), {
      direction: "before",
      boundary: { id: `client-${DEFAULT_PAGE_SIZE + 1}`, restaurantName: `Restaurant ${DEFAULT_PAGE_SIZE + 1}` },
    }, DEFAULT_PAGE_SIZE);
    expect(beforePage.sites[0]?.id).toBe("client-1");
    expect(beforePage.sites.at(-1)?.id).toBe(`client-${DEFAULT_PAGE_SIZE}`);
    expect(beforePage.previousHref).toBe("/dashboard/brand?siteBefore=client-1");
    expect(beforePage.nextHref).toBe(`/dashboard/brand?siteAfter=client-${DEFAULT_PAGE_SIZE}`);
  });

  it("uses one configured page size for both bounded query and returned page", () => {
    const pageSize = 3;
    const query = partnerBrandSiteQuery("partner-1", ["cafe"], pageSize);
    const page = assemblePartnerBrandSitesPage(siteRows(pageSize + 1), null, pageSize);

    expect(query.take).toBe(pageSize + 1);
    expect(page.sites).toHaveLength(pageSize);
    expect(page.nextHref).toBe("/dashboard/brand?siteAfter=client-3");
  });
});
