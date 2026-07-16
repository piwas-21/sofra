import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import SignupForm from "@/components/SignupForm";
// Control-plane routes (/login) are NOT under [locale] — use plain next/link so
// the locale isn't prefixed (that's how PartnerSection links to /login).
import Link from "next/link";
import { marketingPageMetadata } from "@/lib/seo";

// Direct restaurant self-serve signup (ADR-004). The form drops a lead into the
// founder queue (POST /api/signup); conversion stays founder-operated for now.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "signup" });
  return marketingPageMetadata({
    locale,
    path: "/signup",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function SignupPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "signup" });

  return (
    <>
      <Header />
      <main>
        <section id="signup">
          <div className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
            <SectionLabel>{t("label")}</SectionLabel>
            <h1 className="mt-4 font-display font-bold text-5xl md:text-6xl">{t("title")}</h1>
            <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

            <ul className="mt-8 grid gap-3 sm:grid-cols-3">
              {(["quick", "personal", "noCard"] as const).map((k) => (
                <li key={k} className="hand-drawn-border bg-card p-4">
                  <h2 className="font-hand text-2xl font-bold">{t(`points.${k}.title`)}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`points.${k}.text`)}</p>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <SignupForm />
            </div>

            <p className="mt-6 font-label text-sm text-muted-foreground">
              {t("loginHint")}{" "}
              <Link href="/login" className="underline">
                {t("loginLink")}
              </Link>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
