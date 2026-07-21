import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { controlLocale } from "@/lib/control-locale";
import ForgotPasswordForm from "@/components/control/ForgotPasswordForm";

export default async function ForgotPage() {
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <Link href="/" className="font-hand text-4xl font-bold text-primary">
        SofraPiwas
      </Link>
      <h1 className="mt-8 font-display font-bold text-5xl">{t("forgotTitle")}</h1>
      <p className="mt-3 text-muted-foreground">{t("forgotIntro")}</p>
      <div className="mt-8 hand-drawn-border bg-card p-6">
        <ForgotPasswordForm
          labels={{
            email: t("email"),
            send: t("sendReset"),
            sending: t("sending"),
            sent: t("resetSent"),
          }}
        />
      </div>
    </main>
  );
}
