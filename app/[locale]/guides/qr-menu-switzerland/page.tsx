import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import DiscoveryGuidePage from "@/components/DiscoveryGuidePage";
import { DISCOVERY_CONTENT_LAST_CHECKED, SWITZERLAND_SOURCES, SWITZERLAND_STEP_KEYS } from "@/components/discovery-guide-data";
import { marketingPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "discovery.switzerland" });
  return marketingPageMetadata({
    locale,
    path: "/guides/qr-menu-switzerland",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function SwitzerlandQrGuide({ params }: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "discovery.switzerland" });
  const checkedDate = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(DISCOVERY_CONTENT_LAST_CHECKED));
  return <DiscoveryGuidePage
    locale={locale}
    path="/guides/qr-menu-switzerland"
    metaTitle={t("meta.title")}
    metaDescription={t("meta.description")}
    label={t("label")}
    title={t("title")}
    subtitle={t("subtitle")}
    checked={t("checked", { date: checkedDate })}
    intro={t("intro")}
    stepsTitle={t("stepsTitle")}
    steps={SWITZERLAND_STEP_KEYS.map((key) => ({ key, title: t("steps." + key + ".title"), body: t("steps." + key + ".body") }))}
    fieldCheck={{ title: t("fieldCheck.title"), body: t("fieldCheck.body") }}
    sourcesTitle={t("sources.title")}
    sourcesNote={t("sources.note", { date: checkedDate })}
    sources={SWITZERLAND_SOURCES.map(({ key, url }) => ({ key, url, label: t("sources.items." + key) }))}
    relatedLabel={t("related.label")}
    related={[
      { href: "/compare/alternatives", label: t("related.alternatives") },
      { href: "/guides/qr-menu-geneva", label: t("related.geneva") },
    ]}
  />;
}
