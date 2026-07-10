import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { controlLocale } from "@/lib/control-locale";

// Mollie redirectUrl target after the first-payment checkout (S9). Public and
// unauthenticated — the TENANT lands here, not the founder. Payment state is
// NOT known here (the webhook is the source of truth); keep it generic.
export default async function BillingThanksPage() {
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.thanks" });

  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <Link href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </Link>
      <h1 className="mt-8 font-display font-bold text-5xl">{t("title")}</h1>
      <p className="mt-4 text-muted-foreground">{t("body")}</p>
      <p className="mt-2 font-label text-sm text-muted-foreground">{t("questions")}</p>
    </main>
  );
}
