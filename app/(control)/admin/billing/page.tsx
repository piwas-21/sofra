import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { mollieConfigured } from "@/lib/mollie";
import { BILLING_INTERVALS } from "@/lib/billing";
import BillingCreateForm from "@/components/control/BillingCreateForm";

// Mollie interval string → control.admin.intervals key (display only; the
// billing state machine in lib/billing.ts is untouched).
const intervalKey = (mollie: string) =>
  Object.entries(BILLING_INTERVALS).find(([, i]) => i.mollie === mollie)?.[0];

export default async function AdminBillingPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });
  const intervalLabel = (mollie: string) => {
    const key = intervalKey(mollie);
    return key ? t(`intervals.${key}`) : mollie;
  };
  const billings = await db.tenantBilling.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("billing.title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("billing.intro")}</p>
      </div>

      {!mollieConfigured() && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("billing.mollieMissing")}
        </p>
      )}

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("billing.newAccount")}</h2>
        <div className="mt-4 hand-drawn-border bg-card p-5">
          <BillingCreateForm disabled={!mollieConfigured()} />
        </div>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">
          {t("billing.tenantsHeading", { count: billings.length })}
        </h2>
        <ul className="mt-4 grid gap-4">
          {billings.map((b) => {
            const active = b.subscriptions.filter((s) => s.status === "ACTIVE");
            const pending = b.subscriptions.filter((s) => s.status === "PENDING");
            const last = b.payments[0];
            return (
              <li key={b.id} className="hand-drawn-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <Link
                      href={`/admin/billing/${b.id}`}
                      className="font-hand text-2xl font-bold underline"
                    >
                      {b.tenantSlug}
                    </Link>
                    <span className="font-label text-sm text-muted-foreground block">
                      {b.name} · {b.email} · {t("billing.since", { date: shortDate(b.createdAt) })}
                    </span>
                  </span>
                  <span className="font-label text-sm text-right">
                    {active.map((s) => (
                      <span key={s.id} className="block">
                        {eur(s.amountCents)} · {intervalLabel(s.interval)} · {t("billing.active")}
                      </span>
                    ))}
                    {pending.length > 0 && (
                      <span className="block text-muted-foreground">
                        {t("billing.awaitingFirstPayment", { count: pending.length })}
                      </span>
                    )}
                    {last && (
                      <span className="block text-muted-foreground">
                        {t("billing.lastPayment", {
                          status: last.status,
                          amount: eur(last.amountCents),
                        })}
                      </span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
          {billings.length === 0 && (
            <li className="font-label text-muted-foreground">{t("billing.empty")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
