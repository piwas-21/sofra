import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import { marketingPageMetadata } from "@/lib/seo";
import { contactEmail, sellerIdentity } from "@/lib/seller-identity";

// RUNTIME, not prerendered — and this is load-bearing rather than a preference.
//
// The imprint reads `sellerIdentity()`, which reads `process.env`. Statically
// generated, that call is evaluated at BUILD time, so the page bakes in whatever
// the identity was when the image was built and NO amount of setting the values
// on the box can ever change it. Measured exactly that way: the details were set
// in the box .env, the container was recreated and reported them in `printenv`,
// and the page still rendered "not published here yet" — because the HTML had
// been decided hours earlier.
//
// It is the same shape as `robots.txt` in this repo (CLAUDE.md §7: "baked, not
// runtime — a wrong posture takes a rebuild, not a box .env edit"). The
// difference is that robots.txt is *documented* as build-time and this page's
// whole purpose is to publish runtime configuration, so here it is a defect.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  return marketingPageMetadata({
    locale,
    path: "/legal",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

/**
 * Imprint + privacy (SOFRA-BILLING-IDENTITY-PLAN B9, gap G6).
 *
 * The site that takes the money had neither, while the tenant app has both. In
 * the Netherlands an online service provider must show its name, address, email,
 * KVK number and VAT identification number (art. 3:15d BW) — and this is also
 * where a customer looks to check they are paying a real company.
 *
 * The identity is read from the SAME env block the invoices use, so the two can
 * never disagree: a customer comparing this page with their invoice is looking at
 * one source. When it is unset — which it is until the owner supplies it (plan
 * §8.1) — the page says so plainly rather than rendering blanks that read as a
 * finished page with nothing in it.
 *
 * The privacy text claims only what was verified against the code: the schema, the
 * retention sweep and every outbound call. It deliberately makes no exhaustive
 * claim and names each erasure exception, because a privacy statement that is
 * wrong is worse than one that is thin.
 *
 * The commercial TERMS are the owner's to write. The section below says there are
 * none published yet rather than asserting a contract formation that does not
 * happen — nothing in signup records an acceptance.
 */
export default async function LegalPage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  // NOT setRequestLocale(locale) — that is next-intl's explicit opt-in to STATIC
  // rendering, and it silently defeats `force-dynamic` above. Every sibling
  // marketing page calls it, correctly, because their content is build-time
  // constant. This one's is not.
  const t = await getTranslations({ locale, namespace: "legal" });
  const seller = sellerIdentity();
  const email = contactEmail();

  const processors: { name: string; purposeKey: string; region: string }[] = [
    { name: "Netcup GmbH", purposeKey: "hosting", region: "DE" },
    { name: "Mollie B.V.", purposeKey: "payments", region: "NL" },
    { name: "Resend", purposeKey: "email", region: "US" },
    { name: "Sentry", purposeKey: "monitoring", region: "EU" },
    { name: "GitHub (Microsoft)", purposeKey: "source", region: "US" },
  ];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
        <SectionLabel>{t("kicker")}</SectionLabel>
        <h1 className="mt-3 font-display text-5xl font-bold md:text-6xl">{t("title")}</h1>

        <section className="mt-12">
          <h2 className="font-hand text-3xl font-bold">{t("imprint.title")}</h2>
          {/* dir="ltr" on the whole block, and <bdi> on each interpolated value.
              Measured under `ar` with a real layout engine: without it a Dutch
              postal code splits — "1015 CJ Amsterdam" renders as
              "CJ Amsterdam 1015", because the leading digits have no preceding
              strong-L character and resolve into an RTL-level number run. A
              trailing period does the same to "Mollie B.V.". An address a reader
              cannot trust is the one thing an imprint must not produce. */}
          {seller ? (
            <address dir="ltr" className="mt-4 not-italic font-label leading-relaxed">
              <p className="font-bold">{seller.legalName}</p>
              <p>{seller.addressLine1}</p>
              {seller.addressLine2 && <p>{seller.addressLine2}</p>}
              <p>
                {seller.postalCode} {seller.city}
              </p>
              <p>{seller.countryCode}</p>
            </address>
          ) : (
            <p className="mt-4 font-label text-muted-foreground">{t("imprint.unset")}</p>
          )}
          {seller && (
            <p className="mt-3 font-label">
              {t("imprint.kvk", { value: seller.registrationNo })}
              <br />
              {t("imprint.vat", { value: seller.vatNumber })}
            </p>
          )}
          {/* Outside the seller block on purpose: three obligations run through
              this address — the art. 3:15d contact, the data-subject route, and
              "ask us for the terms" — so it must be reachable even before the
              rest of the identity is published. */}
          {email && (
            <p className="mt-3 font-label">
              {t("imprint.contact")}:{" "}
              <a href={`mailto:${email}`} className="underline" dir="ltr">
                <bdi>{email}</bdi>
              </a>
            </p>
          )}
        </section>

        <section className="mt-12">
          <h2 className="font-hand text-3xl font-bold">{t("privacy.title")}</h2>
          <p className="mt-2 font-label text-sm text-muted-foreground">{t("privacy.updated")}</p>

          {(["controller", "what", "why", "keep", "rights", "cookies"] as const).map((key) => (
            <div key={key} className="mt-6">
              <h3 className="font-label font-bold">{t(`privacy.${key}.title`)}</h3>
              <p className="mt-1 font-label leading-relaxed">{t(`privacy.${key}.body`)}</p>
            </div>
          ))}

          <div className="mt-6">
            <h3 className="font-label font-bold">{t("privacy.processors.title")}</h3>
            <p className="mt-1 font-label leading-relaxed">{t("privacy.processors.body")}</p>
            <ul className="mt-3 grid gap-1 font-label text-sm">
              {processors.map((p) => (
                <li key={p.name}>
                  <bdi className="font-bold">{p.name}</bdi> —{" "}
                  {t(`privacy.processors.${p.purposeKey}`)} (<bdi>{p.region}</bdi>)
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-hand text-3xl font-bold">{t("terms.title")}</h2>
          <p className="mt-2 font-label leading-relaxed">{t("terms.body")}</p>
        </section>
      </main>
      <Footer />
    </>
  );
}
