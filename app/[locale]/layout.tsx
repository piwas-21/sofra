import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  Quicksand,
  Amatic_SC,
  Caveat,
  Kalam,
  Special_Elite,
} from "next/font/google";
import "../globals.css";
import { routing } from "@/i18n/routing";

// ---- Sofra craft typography stack ----
const quicksand = Quicksand({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

const amaticSC = Amatic_SC({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  variable: "--font-display",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hand",
  display: "swap",
});

const kalam = Kalam({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700"],
  variable: "--font-label",
  display: "swap",
});

const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-mono",
  display: "swap",
});

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
    title: t("title"),
    description: t("description"),
    icons: { icon: "/favicon.svg" },
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
      suppressHydrationWarning
      className={`${quicksand.variable} ${amaticSC.variable} ${caveat.variable} ${kalam.variable} ${specialElite.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased font-sans paper-texture">
        {/* Dark-mode init: runs during HTML parse, before hydration, so the
            page doesn't flash the wrong theme. Class-based `.dark` — this
            deliberately diverges from the RUMI frontend's data-theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
              const theme = localStorage.getItem('theme') ||
                (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
              if (theme === 'dark') {
                document.documentElement.classList.add('dark');
              }
            } catch (e) {}`,
          }}
        />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
