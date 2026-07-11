import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, planState, type PlanState } from "@/lib/billing-display";
import StartPaymentButton from "@/components/control/StartPaymentButton";

export default async function DashboardBillingPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.plan" });

  // Plan-status node via if/else (avoids a nested ternary — Sonar S3358).
  const statusNode = (state: PlanState, startDate: Date | null, billingId: string) => {
    if (state === "active") {
      return (
        <p className="font-label text-craft-success-text dark:text-craft-success">
          {startDate ? t("activeNextCharge", { date: shortDate(startDate) }) : t("active")}
        </p>
      );
    }
    if (state === "pay") {
      return (
        <div className="grid gap-2">
          <p className="font-label text-muted-foreground">{t("awaitingPayment")}</p>
          <StartPaymentButton billingId={billingId} />
        </div>
      );
    }
    if (state === "processing") {
      return <p className="font-label text-muted-foreground">{t("processing")}</p>;
    }
    return <p className="font-label text-muted-foreground">{t("inactive")}</p>;
  };

  const billings = await db.tenantBilling.findMany({
    where: { client: { partnerId: partner.id } },
    include: {
      client: true,
      subscriptions: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </div>

      {billings.length === 0 ? (
        <p className="font-hand text-2xl text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-6">
          {billings.map((b) => {
            const sub = b.subscriptions[0];
            const restaurant = b.client?.restaurantName ?? b.tenantSlug;
            const state = planState(sub, b.payments);
            return (
              <li key={b.id} className="hand-drawn-border bg-card p-6 grid gap-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-hand text-3xl font-bold">{restaurant}</h2>
                  {b.liveSince && (
                    <span className="font-label text-sm text-muted-foreground">
                      {t("liveSinceShort", { date: shortDate(b.liveSince) })}
                    </span>
                  )}
                </div>

                {sub ? (
                  <>
                    <p className="font-hand text-2xl font-bold">
                      {t("amountLine", {
                        amount: eur(sub.amountCents),
                        interval: t(`interval.${intervalKeyOf(sub.interval)}`),
                      })}
                    </p>
                    {statusNode(state, sub.startDate, b.id)}
                  </>
                ) : (
                  <p className="font-label text-muted-foreground">{t("noPlan")}</p>
                )}

                {b.payments.length > 0 && (
                  <div className="grid gap-1">
                    <h3 className="font-label text-sm uppercase tracking-wide text-muted-foreground">
                      {t("history")}
                    </h3>
                    <ul className="grid gap-1 font-label text-sm">
                      {b.payments.map((p) => (
                        <li
                          key={p.id}
                          className="flex flex-wrap justify-between gap-2 text-muted-foreground"
                        >
                          <span>
                            {shortDate(p.createdAt)} · {p.sequenceType}
                          </span>
                          <span>
                            {eur(p.amountCents)} · {p.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
