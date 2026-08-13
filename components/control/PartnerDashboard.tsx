import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, planState, type PlanState } from "@/lib/billing-display";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";
import type { BillingIdentity } from "@/lib/generated/prisma/client";
import ClientForm from "./ClientForm";
import ClientStatusBadge from "./ClientStatusBadge";
import StartPaymentButton from "./StartPaymentButton";

/**
 * The reseller's dashboard — unchanged behaviour, lifted out of `page.tsx` when the
 * owner view stopped being a branch inside it (SOFRA-ONBOARDING-PLAN O4).
 */

type PartnerBilling = {
  id: string;
  tenantSlug: string;
  liveSince: Date | null;
  // The three `resolveIdentityForPlan` reads — the reseller's landing page is a
  // payment surface too, and it must not offer a button the gate would refuse.
  billingIdentityId: string | null;
  payerUserId: string | null;
  billingIdentity: BillingIdentity | null;
  client: { restaurantName: string; partnerId: string } | null;
  subscriptions: { amountCents: number; interval: string; status: string }[];
  payments: { sequenceType: string; status: string }[];
};

type PartnerClient = {
  id: string;
  restaurantName: string;
  city: string | null;
  contactName: string | null;
  status: string;
  updatedAt: Date;
};

/**
 * What the partner can do about a client's plan right now. Guard clauses rather than a
 * chain of ternaries (Sonar S3358).
 *
 * `state` is only ever "pay" or "processing" here — the caller's filter admits exactly
 * those two — so "processing" is the mandate-validation window. The reseller keeps the
 * terse line: they read this queue as a pipeline and are not the one who just watched
 * money leave their own account (the owner gets `<ActivatingPanel />` instead). Neither
 * branch renders a pay button in that window: a second payment is the trap it sets.
 */
function planAction(args: {
  state: PlanState;
  billingId: string;
  invoiceable: boolean;
  tp: (key: string) => string;
}) {
  const { state, billingId, invoiceable, tp } = args;
  // Same rule as the owner card and the Plan page: `startPaymentAction` refuses a
  // plan with no billing identity, so a button here would only ever error. This
  // is the RESELLER's landing page — /login sends every non-admin to /dashboard,
  // so it is the most prominent of the three payment surfaces, not the least.
  if (state === "pay" && !invoiceable) {
    return (
      <div className="grid gap-2">
        <Link href="/dashboard/billing/details" className="btn-primary w-fit">
          {tp("addBillingDetails")}
        </Link>
        <span className="font-label text-sm text-muted-foreground">
          {tp("billingDetailsFirst")}
        </span>
      </div>
    );
  }
  if (state === "pay") {
    return (
      <div className="grid gap-2">
        <StartPaymentButton billingId={billingId} />
        <span className="font-label text-sm text-muted-foreground">{tp("firstChargeNote")}</span>
      </div>
    );
  }
  return <p className="font-label text-muted-foreground">{tp("processing")}</p>;
}

export default async function PartnerDashboard({
  locale,
  partnerName,
  billings,
  clients,
}: {
  readonly locale: string;
  readonly partnerName: string;
  readonly billings: PartnerBilling[];
  readonly clients: PartnerClient[];
}) {
  const t = await getTranslations({ locale, namespace: "control.dashboard" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });

  // Resolved through the SAME path as the gate and the write.
  //
  // Sequential, and reusing one lookup: a reseller's plans all belong to ONE
  // party, so `resolveIdentityForPlan` returns the same row for every plan whose
  // own link is null. Mapped concurrently it would be N identical queries against
  // a list that grows with every tenant they onboard. Same shape as
  // /dashboard/billing.
  const invoiceableByPlan = new Map<string, boolean>();
  let partyIdentity: Awaited<ReturnType<typeof resolveIdentityForPlan>> | undefined;
  for (const b of billings) {
    const identity = b.billingIdentity ?? (partyIdentity ??= await resolveIdentityForPlan(b));
    invoiceableByPlan.set(b.id, isInvoiceable(identity));
  }

  // Plans that still need the payer's attention: awaiting a payment, or a payment
  // being processed.
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
        // `liveSince` is set by the founder at onboarding, so for a reseller plan
        // (defined AFTER the tenant is live) its absence just means "date unknown" —
        // the tenant is live either way.
        const whereItStands = b.liveSince
          ? tp("liveSince", { restaurant, date: shortDate(b.liveSince) })
          : tp("liveSinceUnknown", { restaurant });
        return (
          <section key={b.id} className="hand-drawn-border bg-card p-6 sm:p-8 grid gap-4">
            <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">
              {tp("welcomeKicker")}
            </p>
            <h2 className="font-display font-bold text-4xl">
              {tp("welcomeTitle", { name: partnerName })}
            </h2>
            <p className="text-muted-foreground">{whereItStands}</p>
            <p className="font-hand text-3xl font-bold">
              {tp("amountLine", {
                amount: eur(sub.amountCents),
                interval: tp(`interval.${intervalKeyOf(sub.interval)}`),
              })}
            </p>
            {planAction({
              state: planState(sub, b.payments),
              billingId: b.id,
              invoiceable: invoiceableByPlan.get(b.id) ?? false,
              tp,
            })}
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
