import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { partnerBaseDomains } from "@/lib/partner-domain-access";
import BaseDomainCard from "@/components/control/BaseDomainCard";
import BaseDomainClaimForm from "@/components/control/BaseDomainClaimForm";

/**
 * `/dashboard/domains` — a partner's own zones
 * (SOFRA-PARTNER-FLEXIBILITY-PLAN D1/D1b).
 *
 * `requirePartner()`, not `requirePartnerOrOwner()`: a direct restaurant owner has
 * exactly one tenant and no clients to put under a zone, so this surface has nothing
 * to offer them and an OWNER is bounced to their own dashboard. Every read is scoped
 * by `partnerId` inside `partnerBaseDomains` — one partner can never see another's
 * claim, verified or not.
 *
 * Never cached: a check performed on this page changes what it must show, and the
 * rows are per-user.
 */
export const dynamic = "force-dynamic";

export default async function PartnerDomainsPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.baseDomain" });
  const domains = await partnerBaseDomains(partner.id);
  // One clock for the whole render, so two cards never disagree about staleness.
  const now = new Date();

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
      </div>

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">{t("addTitle")}</h2>
        <p className="mt-2 font-label text-muted-foreground">{t("addIntro")}</p>
        <div className="mt-4">
          <BaseDomainClaimForm />
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="font-hand text-3xl font-bold">{t("listTitle")}</h2>
        {domains.length === 0 ? (
          <p className="font-label text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="grid gap-4">
            {domains.map((row) => (
              <BaseDomainCard key={row.id} locale={locale} row={row} now={now} />
            ))}
          </ul>
        )}
      </section>

      <p className="font-label text-sm text-muted-foreground">{t("footerNote")}</p>
    </div>
  );
}
