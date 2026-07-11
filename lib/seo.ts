import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sofrapiwas.com";

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
    openGraph: { title, description, siteName: "Sofra", locale, type: "website" },
    robots: { index: true, follow: true },
  };
}
