import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import "../globals.css";
import { routing } from "@/i18n/routing";
import { SITE_URL, pageAlternates, OG_IMAGE } from "@/lib/seo";
import { fontClassNames, themeInitScript } from "@/lib/fonts";
import ThemeSync from "@/components/ThemeSync";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("description"),
    icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
    alternates: pageAlternates(locale, ""),
    openGraph: {
      title: t("title"),
      description: t("description"),
      siteName: "Sofra",
      locale,
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }],
    },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      suppressHydrationWarning
      className={fontClassNames}
    >
      <body className="min-h-screen bg-background text-foreground antialiased font-sans paper-texture">
        {/* Theme init before hydration — see lib/fonts.ts */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeSync />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
