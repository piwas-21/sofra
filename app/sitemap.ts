import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";

// Marketing routes per locale ("" = landing). Content-engine pages
// (AEO plan §2) ship in every locale, same as the landing page.
const PATHS = ["", "/case/rumi", "/compare/gloriafood", "/changelog"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routing.locales.flatMap((locale) =>
    PATHS.map((path) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority:
        (path === "" ? 1 : 0.7) * (locale === routing.defaultLocale ? 1 : 0.8),
    })),
  );
}
