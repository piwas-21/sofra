import { getTranslations } from "next-intl/server";
import { findValidToken } from "@/lib/tokens";
import { controlLocale } from "@/lib/control-locale";
import SetPasswordForm from "@/components/control/SetPasswordForm";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = await findValidToken(token, "invite");
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <a href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </a>
      <h1 className="mt-8 font-display font-bold text-5xl">{t("inviteTitle")}</h1>
      {valid ? (
        <>
          <p className="mt-3 text-muted-foreground">
            {t("inviteIntro", { name: valid.user.name })}
          </p>
          <div className="mt-8 hand-drawn-border bg-card p-6">
            <SetPasswordForm
              token={token}
              purpose="invite"
              labels={{
                newPassword: t("newPassword"),
                repeatPassword: t("repeatPassword"),
                submit: t("setPassword"),
                saving: t("saving"),
              }}
            />
          </div>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground">{t("inviteInvalid")}</p>
      )}
    </main>
  );
}
