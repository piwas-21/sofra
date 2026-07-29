import { getTranslations } from "next-intl/server";
import { requirePartnerOrOwner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, planState, type PlanState } from "@/lib/billing-display";
import ClientForm from "@/components/control/ClientForm";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import StartPaymentButton from "@/components/control/StartPaymentButton";
import ActivatingPanel from "@/components/control/ActivatingPanel";

/**
 * Which "where is my restaurant" line the welcome hero shows — or none.
 * Extracted so the choice reads as a decision instead of a nested ternary
 * (Sonar S3358).
 *
 * Returns null for an owner who is already activating: `<ActivatingPanel />`
 * says what is happening in full, and the hero's "start your subscription"
 * nudge directly contradicts a panel that opens with "your first payment went
 * through". A line that argues with the line below it is worse than no line.
 */
function liveSinceLine(
  liveSince: Date | null,
  restaurant: string,
  isOwner: boolean,
  activating: boolean,
  tp: (key: string, values?: Record<string, string>) => string,
): string | null {
  if (liveSince) return tp("liveSince", { restaurant, date: shortDate(liveSince) });
  if (!isOwner) return tp("liveSinceUnknown", { restaurant });
  return activating ? null : tp("notLiveYet", { restaurant });
}

/**
 * What the payer can do about this plan right now. Written as guard clauses
 * rather than a chain of ternaries (Sonar S3358), mirroring `statusNode` in
 * `/dashboard/billing`.
 *
 * `state` is only ever "pay" or "processing" here — the caller's filter admits
 * exactly those two — so "processing" is the mandate-validation window. An owner
 * gets it spelled out; a partner keeps the terse line, because a reseller reads
 * this queue as a pipeline and is not the one who just watched money leave their
 * account. Neither branch renders a pay button in that window: a second payment
 * is the trap it sets.
 */
function planAction(args: {
  state: PlanState;
  billingId: string;
  isOwner: boolean;
  locale: string;
  restaurant: string;
  tp: (key: string) => string;
}) {
  const { state, billingId, isOwner, locale, restaurant, tp } = args;
  if (state === "pay") {
    return (
      <div className="grid gap-2">
        <StartPaymentButton billingId={billingId} />
        <span className="font-label text-sm text-muted-foreground">{tp("firstChargeNote")}</span>
      </div>
    );
  }
  if (isOwner) return <ActivatingPanel locale={locale} restaurant={restaurant} />;
  return <p className="font-label text-muted-foreground">{tp("processing")}</p>;
}

export default async function DashboardPage() {
  const user = await requirePartnerOrOwner();
  const isOwner = user.role === "OWNER";
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.dashboard" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });

  // Billings scoped to the caller: an OWNER pays via payerUserId (ADR-004); a
  // PARTNER via their CRM clients.
  const billings = await db.tenantBilling.findMany({
    where: isOwner ? { payerUserId: user.id } : { client: { partnerId: user.id } },
    include: {
      client: true,
      subscriptions: { orderBy: { createdAt: "desc" } },
      // Only first payments distinguish "pay" from "processing" (planState);
      // scope + bound so the unboundedly-growing recurring history is never
      // pulled into this request path.
      payments: { where: { sequenceType: "first" }, orderBy: { createdAt: "desc" }, take: 20 },
    },
    orderBy: { createdAt: "desc" },
  });
  // Plans that still need the payer's attention (welcome hero): awaiting a
  // payment, or a payment being processed.
  const awaiting = billings.filter((b) => {
    const st = planState(b.subscriptions[0], b.payments);
    return st === "pay" || st === "processing";
  });
  // Reseller CRM — partners only; an owner has no clients.
  const clients = isOwner
    ? []
    : await db.client.findMany({ where: { partnerId: user.id }, orderBy: { updatedAt: "desc" } });

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{isOwner ? t("ownerTitle") : t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{isOwner ? t("ownerIntro") : t("intro")}</p>
      </div>

      {awaiting.map((b) => {
        const sub = b.subscriptions[0];
        if (!sub) return null;
        // Owner billings carry no CRM client; the slug identifies the restaurant.
        const restaurant = b.client?.restaurantName ?? b.tenantSlug;
        const state = planState(sub, b.payments);
        // `liveSince` is set by the founder at onboarding, so for a reseller plan
        // (defined AFTER the tenant is live) its absence just means "date
        // unknown" — the tenant is live either way. A self-serve owner is the
        // opposite case: they signed up minutes ago and nothing has been
        // provisioned, so telling them their restaurant "is live" is simply false.
        const whereItStands = liveSinceLine(
          b.liveSince,
          restaurant,
          isOwner,
          state === "processing",
          tp,
        );
        return (
          <section key={b.id} className="hand-drawn-border bg-card p-6 sm:p-8 grid gap-4">
            <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">
              {tp("welcomeKicker")}
            </p>
            <h2 className="font-display font-bold text-4xl">
              {tp("welcomeTitle", { name: user.name })}
            </h2>
            {whereItStands && <p className="text-muted-foreground">{whereItStands}</p>}
            <p className="font-hand text-3xl font-bold">
              {tp("amountLine", {
                amount: eur(sub.amountCents),
                interval: tp(`interval.${intervalKeyOf(sub.interval)}`),
              })}
            </p>
            {planAction({
              state,
              billingId: b.id,
              isOwner,
              locale,
              restaurant,
              tp,
            })}
          </section>
        );
      })}

      {isOwner ? (
        awaiting.length === 0 && (
          <p className="font-hand text-2xl text-muted-foreground">{t("ownerAllSet")}</p>
        )
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
