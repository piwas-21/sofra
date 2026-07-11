import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, planState } from "@/lib/billing-display";
import ClientForm from "@/components/control/ClientForm";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import StartPaymentButton from "@/components/control/StartPaymentButton";

export default async function DashboardPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.dashboard" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });

  const [clients, billings] = await Promise.all([
    db.client.findMany({ where: { partnerId: partner.id }, orderBy: { updatedAt: "desc" } }),
    db.tenantBilling.findMany({
      where: { client: { partnerId: partner.id } },
      include: {
        client: true,
        subscriptions: { orderBy: { createdAt: "desc" } },
        payments: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  // Plans that still need the partner's attention (welcome hero): awaiting a
  // payment, or a payment being processed.
  const awaiting = billings.filter((b) => {
    const st = planState(b.subscriptions[0], b.payments);
    return st === "pay" || st === "processing";
  });

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </div>

      {awaiting.map((b) => {
        const sub = b.subscriptions[0];
        if (!sub) return null;
        const restaurant = b.client?.restaurantName ?? b.tenantSlug;
        const state = planState(sub, b.payments);
        return (
          <section key={b.id} className="hand-drawn-border bg-card p-6 sm:p-8 grid gap-4">
            <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">
              {tp("welcomeKicker")}
            </p>
            <h2 className="font-display font-bold text-4xl">
              {tp("welcomeTitle", { name: partner.name })}
            </h2>
            <p className="text-muted-foreground">
              {b.liveSince
                ? tp("liveSince", { restaurant, date: shortDate(b.liveSince) })
                : tp("liveSinceUnknown", { restaurant })}
            </p>
            <p className="font-hand text-3xl font-bold">
              {tp("amountLine", {
                amount: eur(sub.amountCents),
                interval: tp(`interval.${intervalKeyOf(sub.interval)}`),
              })}
            </p>
            {state === "pay" ? (
              <div className="grid gap-2">
                <StartPaymentButton billingId={b.id} />
                <span className="font-label text-sm text-muted-foreground">{tp("firstChargeNote")}</span>
              </div>
            ) : (
              <p className="font-label text-muted-foreground">{tp("processing")}</p>
            )}
          </section>
        );
      })}

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">{t("addClient")}</h2>
        <div className="mt-4">
          <ClientForm />
        </div>
      </section>

      {clients.length === 0 ? (
        <p className="font-hand text-2xl text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-4">
          {clients.map((c) => (
            <li key={c.id}>
              <a
                href={`/dashboard/clients/${c.id}`}
                className="hand-drawn-border bg-card p-5 flex flex-wrap items-center justify-between gap-3 hover:rotate-[-0.3deg] transition-transform"
              >
                <span className="min-w-0">
                  <span className="font-hand text-2xl font-bold block truncate">
                    {c.restaurantName}
                  </span>
                  <span className="font-label text-sm text-muted-foreground">
                    {[c.city, c.contactName].filter(Boolean).join(" · ") || "—"} ·{" "}
                    {t("updated", { date: shortDate(c.updatedAt) })}
                  </span>
                </span>
                <ClientStatusBadge status={c.status} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
