import type { Prisma } from "@/lib/generated/prisma/client";

export const PARTNER_BRAND_SITE_PAGE_SIZE = 20;

export type PartnerBrandSiteCursor = {
  direction: "after" | "before";
  clientId: string;
};

export type PartnerBrandSiteBoundary = {
  id: string;
  restaurantName: string;
};

type SiteSearchParams = {
  siteAfter?: string | string[];
  siteBefore?: string | string[];
};

export function parsePartnerBrandSiteCursor(params: SiteSearchParams): PartnerBrandSiteCursor | null {
  const hasAfter = params.siteAfter !== undefined;
  const hasBefore = params.siteBefore !== undefined;
  if (hasAfter === hasBefore) return null;

  const rawId = hasAfter ? params.siteAfter : params.siteBefore;
  if (typeof rawId !== "string" || rawId.length === 0 || rawId.length > 64) return null;
  return { direction: hasAfter ? "after" : "before", clientId: rawId };
}

export function partnerBrandSiteQuery(
  partnerId: string,
  eligibleSlugs: string[],
  cursor?: { direction: PartnerBrandSiteCursor["direction"]; boundary: PartnerBrandSiteBoundary } | null,
): Pick<Prisma.ClientFindManyArgs, "where" | "orderBy" | "take"> {
  const where: Prisma.ClientWhereInput = {
    partnerId,
    status: "LIVE",
    tenantSlug: { in: eligibleSlugs },
  };
  if (cursor) {
    const comparison = cursor.direction === "after" ? "gt" : "lt";
    where.OR = [
      { restaurantName: { [comparison]: cursor.boundary.restaurantName } },
      {
        restaurantName: cursor.boundary.restaurantName,
        id: { [comparison]: cursor.boundary.id },
      },
    ];
  }

  const order = cursor?.direction === "before" ? "desc" : "asc";
  return {
    where,
    orderBy: [{ restaurantName: order }, { id: order }],
    take: PARTNER_BRAND_SITE_PAGE_SIZE + 1,
  };
}

export function partnerBrandSitePageHref(direction: "after" | "before", clientId: string): string {
  const params = new URLSearchParams({ [direction === "after" ? "siteAfter" : "siteBefore"]: clientId });
  return `/dashboard/brand?${params.toString()}`;
}
