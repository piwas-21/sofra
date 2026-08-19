import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, nextChargeDate, planState } from "@/lib/billing-display";
import PartnerPlanAction from "@/components/control/PartnerPlanAction";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";

export default async function DashboardBillingPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.plan" });

  // The reseller's book, and the SAME plan control the dashboard hero and the client
  // page render (#163, `PartnerPlanAction`).
  //
  // This page used to keep its own copy of that decision — a local `statusNode` with
  // its own pay/processing/active branches. Three copies of one money question is two
  // too many: the free period (T-b) had to suppress the pay button on all three, and a
  // page that judged it privately would have gone on asking a partner for money the
  // other two had just told them was not owed. The one visible loss is this page's
  // extra "Awaiting your first payment." line, which the shared control replaces with
  // the note that says what paying actually does.

  // One instant for every plan on the page (see PartnerDashboard).
  const now = new Date();
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
            const state = planState(sub, b.payments, { trialEndsAt: b.trialEndsAt, now });
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
                    <PartnerPlanAction
                      locale={locale}
                      state={state}
                      billingId={b.id}
                      invoiceable={invoiceableByPlan.get(b.id) ?? false}
                      nextCharge={nextChargeDate(sub.startDate, sub.interval, now)}
                      trialEndsAt={b.trialEndsAt}
                    />
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
