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

export type PartnerBrandSiteRow = PartnerBrandSiteBoundary & { tenantSlug: string | null };
export type PartnerBrandCursorClient = PartnerBrandSiteBoundary & {
  partnerId: string;
  status: string;
  tenantSlug: string | null;
};
export type ActivePartnerBrandSiteCursor = {
  direction: PartnerBrandSiteCursor["direction"];
  boundary: PartnerBrandSiteBoundary;
} | null;
export type PartnerBrandSitesPage = {
  sites: PartnerBrandSiteRow[];
  previousHref: string | null;
  nextHref: string | null;
};

export function eligiblePartnerBrandCursorBoundary(
  candidate: PartnerBrandCursorClient | null,
  partnerId: string,
  eligibleSlugs: Set<string>,
): PartnerBrandSiteBoundary | null {
  const tenantSlug = candidate?.tenantSlug;
  if (candidate?.partnerId !== partnerId || candidate?.status !== "LIVE" || !tenantSlug) return null;
  if (!eligibleSlugs.has(tenantSlug)) return null;
  return { id: candidate.id, restaurantName: candidate.restaurantName };
}

export function assemblePartnerBrandSitesPage(
  rows: PartnerBrandSiteRow[],
  cursor: ActivePartnerBrandSiteCursor,
): PartnerBrandSitesPage {
  const hasExtraSite = rows.length > PARTNER_BRAND_SITE_PAGE_SIZE;
  const sites = rows.slice(0, PARTNER_BRAND_SITE_PAGE_SIZE);
  const isBeforeCursor = cursor?.direction === "before";
  if (isBeforeCursor) sites.reverse();

  const hasPreviousSites = isBeforeCursor ? hasExtraSite : Boolean(cursor);
  const hasNextSites = isBeforeCursor || hasExtraSite;
  const previousHref = hasPreviousSites && sites.length > 0
    ? partnerBrandSitePageHref("before", sites[0].id)
    : null;
  const nextHref = hasNextSites && sites.length > 0
    ? partnerBrandSitePageHref("after", sites[sites.length - 1].id)
    : null;
  return { sites, previousHref, nextHref };
}

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
