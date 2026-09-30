import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getPublishedMarketingRoutePaths } from "@/lib/marketing-routes";
import { IS_CANONICAL_SITE, pageAlternates, SITE_URL } from "@/lib/seo";

// The shared route inventory reads sellerIdentity(), so a static sitemap would
// decide at BUILD time whether /legal is listed and could not react at runtime.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!IS_CANONICAL_SITE) return [];

  const paths = getPublishedMarketingRoutePaths();
  return routing.locales.flatMap((locale) =>
    paths.map((path) => {
      const alternates = pageAlternates(locale, path).languages;
      if (!alternates) {
        throw new Error(`Published route ${path} must have locale alternates.`);
      }
      return {
        url: new URL(`/${locale}${path}`, SITE_URL).toString(),
        alternates: {
          languages: Object.fromEntries(
            Object.entries(alternates).map(([language, href]) => [
              language,
              new URL(href, SITE_URL).toString(),
            ]),
          ),
        },
      };
    }),
  );
}
