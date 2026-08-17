import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/** The one host these pages are the canonical copy of. */
export const CANONICAL_SITE_URL = "https://sofrapiwas.com";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? CANONICAL_SITE_URL;

/**
 * Is THIS deployment the canonical site?
 *
 * False on `staging.sofrapiwas.com` and on any local run, which is what makes `robots.ts`
 * refuse crawlers without a separate flag anyone has to remember to set. Baked, because
 * `NEXT_PUBLIC_SITE_URL` is a build arg — the staging image is its own bake. That is also why
 * CI keeps two separate `.next/cache` entries (`-next-site-` vs `-next-e2e-`): a build made with a
 * different SITE_URL is not interchangeable output.
 */
export const IS_CANONICAL_SITE = SITE_URL === CANONICAL_SITE_URL;

/** The SofraPiwas open-graph / social share image (resolved against metadataBase). */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "SofraPiwas",
} as const;

/**
 * hreflang + canonical for a localized marketing route (AEO plan §1 pattern,
 * shared by the landing layout and the content-engine pages). `path` is the
 * locale-relative route ("" for the landing page, "/changelog", …).
 */
export function pageAlternates(
  locale: string,
  path: string,
): NonNullable<Metadata["alternates"]> {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
      "x-default": `/${routing.defaultLocale}${path}`,
    },
  };
}

/** Full per-locale metadata block for a marketing content page. */
export function marketingPageMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: string;
  path: string;
  title: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    alternates: pageAlternates(locale, path),
    openGraph: {
      title,
      description,
      siteName: "SofraPiwas",
      locale,
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
    robots: { index: true, follow: true },
  };
}
