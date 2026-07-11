import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";

// Marketing routes per locale ("" = landing). Content-engine pages
// (AEO plan §2) ship in every locale, same as the landing page.
const PATHS = ["", "/case/rumi", "/compare/gloriafood", "/changelog"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  // One timestamp for the whole map (also keeps entries consistent) — Gemini, PR #42.
  const now = new Date();
  return routing.locales.flatMap((locale) =>
    PATHS.map((path) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority:
        (path === "" ? 1 : 0.7) * (locale === routing.defaultLocale ? 1 : 0.8),
    })),
  );
}
