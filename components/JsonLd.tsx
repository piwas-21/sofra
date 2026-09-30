import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";
import { FAQ_KEYS } from "./faq-data";
import JsonLdScript from "./JsonLdScript";

/**
 * schema.org JSON-LD for the landing page (AEO — see workspace
 * docs/plans/SOFRA-AEO-PLAN.md §1). Content is static strings from the
 * messages files — no user input reaches these script tags.
 */
export default async function JsonLd({ locale }: { locale: string }) {
  const meta = await getTranslations({ locale, namespace: "meta" });
  const faq = await getTranslations({ locale, namespace: "faq" });

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "SofraPiwas",
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    description: meta("description"),
    // Entity grounding for answer engines: Dutch-registered company.
    // RUMI (Geneva) is the reference customer, not the company location.
    address: { "@type": "PostalAddress", addressCountry: "NL" },
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "SofraPiwas",
    url: SITE_URL,
    inLanguage: [...routing.locales],
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SofraPiwas",
    url: SITE_URL,
    description: meta("description"),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    // The plan builder prices selected modules, languages, appearance, and
    // currency. Do not flatten those configurations into one universal Offer.
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: faq(`items.${key}.q`),
      acceptedAnswer: { "@type": "Answer", text: faq(`items.${key}.a`) },
    })),
  };

  return (
    <JsonLdScript
      data={[organization, website, softwareApplication, faqPage]}
    />
  );
}
