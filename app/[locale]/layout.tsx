import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import "../globals.css";
import { routing } from "@/i18n/routing";
import { fontClassNames, themeInitScript } from "@/lib/fonts";

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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sofrapiwas.com";

  return {
    metadataBase: new URL(siteUrl),
    title: t("title"),
    description: t("description"),
    icons: { icon: "/favicon.svg" },
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        "x-default": `/${routing.defaultLocale}`,
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      siteName: "Sofra",
      locale,
      type: "website",
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
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
