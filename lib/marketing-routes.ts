import { sellerIdentity } from "@/lib/seller-identity";

/** Public marketing paths shared by page metadata and sitemap generation. */
const MARKETING_ROUTES = [
  { path: "", isPublished: () => true },
  { path: "/signup", isPublished: () => true },
  { path: "/case/rumi", isPublished: () => true },
  { path: "/compare/alternatives", isPublished: () => true },
  { path: "/compare/gloriafood", isPublished: () => true },
  { path: "/changelog", isPublished: () => true },
  { path: "/guides/qr-menu-switzerland", isPublished: () => true },
  { path: "/guides/qr-menu-geneva", isPublished: () => true },
  // The imprint is a useful route before publication, but it is not indexable
  // until the owner has supplied the complete, current company identity.
  { path: "/legal", isPublished: () => sellerIdentity() !== null },
] as const;

export type MarketingRoutePath = (typeof MARKETING_ROUTES)[number]["path"];

function findRoute(path: string) {
  const route = MARKETING_ROUTES.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`Add ${path} to the public marketing route inventory first.`);
  }
  return route;
}

export function isMarketingRoutePublished(path: string): boolean {
  return findRoute(path).isPublished();
}

export function getPublishedMarketingRoutePaths(): MarketingRoutePath[] {
  return MARKETING_ROUTES.filter((route) => route.isPublished()).map(
    (route) => route.path,
  );
}
