import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { sellerIdentity } from "@/lib/seller-identity";
import { SITE_URL } from "@/lib/seo";

// Same reason as the legal page: this file calls `sellerIdentity()`, so a static
// sitemap would decide at BUILD time whether /legal is listed and could never
// change its mind once the owner supplies the details.
export const dynamic = "force-dynamic";

// Marketing routes per locale ("" = landing). Content-engine pages
// (AEO plan §2) ship in every locale, same as the landing page.
const BASE_PATHS = ["", "/signup", "/case/rumi", "/compare/gloriafood", "/changelog"] as const;

// /legal is listed only once the company's registration details are actually
// published (SOFRA_LEGAL_* — see lib/seller-identity.ts). Until then the page
// renders an honest "not published here yet", and indexing six URLs whose
// description promises "who runs SofraPiwas" would advertise that emptiness.
const PATHS = sellerIdentity() ? ([...BASE_PATHS, "/legal"] as const) : BASE_PATHS;

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
