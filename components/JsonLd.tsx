import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { FAQ_KEYS } from "./faq-data";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sofrapiwas.com";

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
    name: "Sofra",
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    description: meta("description"),
    // Entity grounding for answer engines: Dutch company, European market.
    // RUMI (Geneva) is the reference customer, not the company location.
    address: { "@type": "PostalAddress", addressCountry: "NL" },
    areaServed: "Europe",
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Sofra",
    url: SITE_URL,
    inLanguage: [...routing.locales],
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Sofra",
    url: SITE_URL,
    description: meta("description"),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    // Free applies to the early-access founding cohort only — name the offer
    // so answer engines don't lift a bare "Sofra is free" claim.
    offers: {
      "@type": "Offer",
      name: "Early access — founding restaurants",
      price: "0",
      priceCurrency: "EUR",
      description: faq(`items.pricing.a`),
    },
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
    <>
      {[organization, website, softwareApplication, faqPage].map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          // JSON of static message strings; "<" escaped so no value can ever
          // close the script tag (standard Next.js JSON-LD hardening).
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(data).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
