import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { controlLocale } from "@/lib/control-locale";
import LoginForm from "@/components/control/LoginForm";
import { SuccessMessage } from "@/components/control/StatusMessage";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    redirect(session.user.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  const { set } = await searchParams;
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <a href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </a>
      <h1 className="mt-8 font-display font-bold text-5xl">{t("loginTitle")}</h1>
      <p className="mt-3 text-muted-foreground">
        {t("loginIntro")}{" "}
        <a className="underline" href="/#partner">
          {t("becomeOne")}
        </a>
      </p>
      <div className="mt-8 hand-drawn-border bg-card p-6">
        {set === "1" && (
          <div className="mb-6">
            <SuccessMessage>{t("passwordSaved")}</SuccessMessage>
          </div>
        )}
        <LoginForm
          labels={{
            email: t("email"),
            password: t("password"),
            signIn: t("signIn"),
            signingIn: t("signingIn"),
            forgot: t("forgotLink"),
          }}
        />
      </div>
    </main>
  );
}
