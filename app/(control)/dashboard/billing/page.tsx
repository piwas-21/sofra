import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import {
  intervalKeyOf,
  nextChargeDate,
  planState,
  type PlanState,
} from "@/lib/billing-display";
import StartPaymentButton from "@/components/control/StartPaymentButton";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";

export default async function DashboardBillingPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.plan" });

  // Plan-status node via if/else (avoids a nested ternary — Sonar S3358).
  //
  // `nextChargeDate` rather than the raw `startDate` this used to print: that column is
  // the FIRST recurring charge and is never advanced, so from month two onward it named
  // a date in the past (see lib/billing-display.ts). Same defect, same fix, on both the
  // reseller's page and the owner's card.
  const statusNode = (
    sub: { startDate: Date | null; interval: string },
    state: PlanState,
    billingId: string,
    invoiceable: boolean,
  ) => {
    if (state === "active") {
      const next = nextChargeDate(sub.startDate, sub.interval, new Date());
      return (
        <p className="font-label text-craft-success-text dark:text-craft-success">
          {next ? t("activeNextCharge", { date: shortDate(next) }) : t("active")}
        </p>
      );
    }
    if (state === "pay") {
      // Same rule as the owner card: `startPaymentAction` refuses a plan with no
      // billing identity, so offering the button here would be a control that
      // only ever errors. Send them to the form instead.
      if (!invoiceable) {
        return (
          <div className="grid gap-2">
            <Link href="/dashboard/billing/details" className="btn-primary w-fit">
              {t("addBillingDetails")}
            </Link>
            <p className="font-label text-sm text-muted-foreground">{t("billingDetailsFirst")}</p>
          </div>
        );
      }
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
      billingIdentity: true,
      subscriptions: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
  });

  // Resolved through the same path as the gate and the write — see OwnerDashboard.
  // Sequential rather than Promise.all on purpose: a reseller's plans all belong
  // to ONE party, so `resolveIdentityForPlan` returns the same row for every
  // unsaved plan. Run concurrently they would be N identical queries; run in
  // order, the first result is reused for the rest.
  const invoiceableByPlan = new Map<string, boolean>();
  let partyIdentity: Awaited<ReturnType<typeof resolveIdentityForPlan>> | undefined;
  for (const b of billings) {
    const identity = b.billingIdentity ?? (partyIdentity ??= await resolveIdentityForPlan(b));
    invoiceableByPlan.set(b.id, isInvoiceable(identity));
  }

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
                    {statusNode(sub, state, b.id, invoiceableByPlan.get(b.id) ?? false)}
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
