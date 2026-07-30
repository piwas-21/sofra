import { getTranslations } from "next-intl/server";
import { tenantForgotPasswordUrl, tenantOrigin, type TenantStage } from "@/lib/tenant-liveness";

/**
 * "Your app is ready — set your admin password" (SOFRA-ONBOARDING-PLAN O4, the piece
 * O3 handed over).
 *
 * O3 closed the credential story mechanically: the tenant frontend now has
 * /forgot-password and /reset-password, so the owner sets their own password and the
 * bootstrap password generated on the box is never read, never emailed, never spoken.
 * The gap left behind was that nobody TELLS the owner. Between paying and being told,
 * a self-serve customer has a running restaurant app on their own subdomain and no
 * idea it exists — which is the same as not having one.
 *
 * The stage comes from `tenantStage`, which earns each claim rather than defaulting to
 * the friendliest one. Only "ready" — the stage backed by the app answering its own
 * health endpoint — renders a link, because only "ready" knows the link works.
 *
 * Deliberately NOT an email. The address on file is the one that signed up; sending
 * "here is where your admin panel lives" unprompted is a phishing shape we would be
 * teaching our own customers to trust. They are already logged in here.
 */
export default async function TenantReadyPanel({
  locale,
  stage,
  domain,
}: {
  readonly locale: string;
  readonly stage: TenantStage;
  readonly domain: string | null;
}) {
  const t = await getTranslations({ locale, namespace: "control.tenantReady" });
  if (stage === "none") return null;

  if (stage === "ready" && domain) {
    const origin = tenantOrigin(domain);
    const resetUrl = tenantForgotPasswordUrl(domain);
    // `tenantOrigin` rejecting the domain is the one way a "ready" tenant reaches this
    // with no usable link — a malformed registry entry that still somehow answered.
    // Fall through to the waiting copy rather than render a broken anchor.
    if (origin && resetUrl) {
      return (
        <div className="grid gap-3 border-l-2 border-primary/40 pl-4">
          <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">
            {t("readyKicker")}
          </p>
          <p className="font-hand text-2xl font-bold">{t("readyTitle")}</p>
          <p className="text-muted-foreground">{t("readyBody", { domain })}</p>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href={resetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              {t("setPassword")}
            </a>
            <a
              href={origin}
              target="_blank"
              rel="noopener noreferrer"
              className="font-label underline underline-offset-4 text-muted-foreground"
            >
              {t("openApp", { domain })}
            </a>
          </div>
          <p className="font-label text-sm text-muted-foreground">{t("setPasswordWhy")}</p>
        </div>
      );
    }
  }

  // Everything short of observed-serving. Three distinct waits, because "we are
  // building it" and "it is built, waiting on a review" are not the same news to
  // someone counting the minutes — and none of the three implies anything is wrong.
  //
  // A "ready" that fell through the block above (it answered, but its registry domain
  // is not a usable host) reads as almostReady, which is precisely what it is: seen
  // serving, no link we are willing to hand out.
  const key = stage === "ready" ? "almostReady" : stage;

  return (
    <div className="grid gap-2 border-l-2 border-muted pl-4">
      <p className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
        {t("waitingKicker")}
      </p>
      <p className="font-hand text-2xl font-bold">{t(`${key}Title`)}</p>
      <p className="font-label text-sm text-muted-foreground">{t(`${key}Body`)}</p>
    </div>
  );
}
