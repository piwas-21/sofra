import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { controlLocale } from "@/lib/control-locale";
import EmailRequestForm from "@/components/control/EmailRequestForm";
import { resendInviteAction } from "@/lib/actions/auth-actions";

// "My invite link died and nobody is watching" (G12) — the page /login points at.
//
// A STATIC segment under the same folder as `/invite/[token]`, which Next resolves
// before the dynamic one. Safe rather than clever: a real token is 43 characters of
// base64url and can never be the literal string "resend".

export default async function ResendInvitePage() {
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <Link href="/" className="font-hand text-4xl font-bold text-primary">
        SofraPiwas
      </Link>
      <h1 className="mt-8 font-display font-bold text-5xl">{t("resendTitle")}</h1>
      <p className="mt-3 text-muted-foreground">{t("resendIntro")}</p>
      <div className="mt-8 hand-drawn-border bg-card p-6">
        <EmailRequestForm
          action={resendInviteAction}
          labels={{
            email: t("email"),
            send: t("sendInvite"),
            sending: t("sending"),
            sent: t("inviteSent"),
          }}
        />
      </div>
      <p className="mt-6 font-label text-sm text-muted-foreground">
        {t("resendHasPassword")}{" "}
        <Link className="underline" href="/forgot">
          {t("forgotLink")}
        </Link>
      </p>
    </main>
  );
}
