import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/seo";
import { resolvePaymentsLink } from "@/lib/onboarding-payments";

// RUNTIME, never prerendered, and never indexed.
//
// Every request must mint a NEW Stripe Account Link: one lives 300 seconds
// (measured), and two calls return two different URLs. A cached page would hand
// a restaurant a dead link and a static one could not exist at all. `noindex` for
// the obvious reason — the URL is the credential.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "onboardingPayments" });
  return { title: t("meta.title"), robots: { index: false, follow: false } };
}

/**
 * The one door between a restaurant and Stripe's hosted onboarding (ADR-011
 * amendment, E4).
 *
 * UNAUTHENTICATED by necessity, and that is why the path carries a 32-byte token
 * rather than a slug: the restaurant has no login here — they log into their own
 * tenant app, never into the control plane — and the link this page produces is a
 * bearer capability over their KYC and their payout bank account. CLAUDE.md §5.1
 * governs the `(control)` plane; this page is deliberately NOT in it. It is on the
 * public site, beside `/signup`, because its visitor is a member of the public,
 * and it holds the same obligation the five unauthenticated control surfaces
 * hold: it answers the same way to every wrong input, so it cannot be asked
 * whether a token is nearly right.
 *
 * It never renders a Stripe URL and never stores one. On success it redirects; the
 * body below only exists for the two states where it cannot.
 */
export default async function OnboardingPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "onboardingPayments" });

  // The page's OWN url becomes Stripe's refresh_url and return_url, so it is built
  // from the request that actually arrived rather than from a constant: a tenant on
  // a partner's own zone, or staging, must come back to where it left.
  const host = (await headers()).get("host");
  const origin = host ? `https://${host}` : SITE_URL;
  const outcome = await resolvePaymentsLink(token, `${origin}/${locale}/onboarding/payments/${token}`);

  // Outside the try/catch-free zone on purpose: `redirect` throws by design in
  // Next, so it must be called where nothing will swallow it.
  if (outcome.kind === "redirect") redirect(outcome.url);

  const body = outcome.kind === "unknownToken" ? "unknownToken" : "unavailable";
  return (
    <>
      <Header />
      <main className="mx-auto grid max-w-2xl gap-4 px-6 py-24">
        <h1 className="font-display text-3xl text-foreground">{t("title")}</h1>
        <p className="font-body text-base text-muted-foreground">{t(body)}</p>
        <p className="font-body text-sm text-muted-foreground">{t("contact")}</p>
      </main>
      <Footer />
    </>
  );
}
