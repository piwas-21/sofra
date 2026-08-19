import { getTranslations } from "next-intl/server";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, nextChargeDate } from "@/lib/billing-display";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";
import { planLine } from "@/lib/client-tenant";
import type { BillingIdentity } from "@/lib/generated/prisma/client";
import PartnerPlanAction from "./PartnerPlanAction";

/**
 * What this one client COSTS, on the partner's client page.
 *
 * A reseller pays SofraPiwas per tenant they onboard (SOFRA-PARTNER-PLAN §9), and until
 * now the only place that said so was the dashboard hero — which renders solely for
 * plans in "pay"/"processing". An ACTIVE plan therefore appeared nowhere at all: the
 * partner could not see the amount they are charged every month for a client they were
 * looking straight at.
 */
export type ClientPlanBilling = {
  id: string;
  tenantSlug: string;
  liveSince: Date | null;
  // The three fields `resolveIdentityForPlan` reads. This is a payment surface, so it
  // must decide invoiceability exactly the way the gate and the write decide it.
  billingIdentityId: string | null;
  payerUserId: string | null;
  billingIdentity: BillingIdentity | null;
  client: { partnerId: string } | null;
  subscriptions: { amountCents: number; interval: string; status: string; startDate: Date | null }[];
  /** FIRST-sequence payments only — what `planState` reads (see the dashboard query). */
  payments: { sequenceType: string; status: string }[];
};

export default async function ClientPlanPanel({
  locale,
  billing,
}: {
  readonly locale: string;
  readonly billing: ClientPlanBilling | null;
}) {
  const t = await getTranslations({ locale, namespace: "control.tenant" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });
  const line = planLine(billing);

  if (!billing || !line) {
    return (
      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">{t("planTitle")}</h2>
        <p className="mt-3 font-label text-muted-foreground">{t("planNoneBody")}</p>
      </section>
    );
  }

  const sub = billing.subscriptions[0];
  // Resolved through the PARTY, not the plan link: a reseller's second tenant is
  // created with `billingIdentityId` null, and reading the link alone would push a
  // partner who already has a complete identity on file at a blank form.
  const invoiceable = isInvoiceable(
    billing.billingIdentity ?? (await resolveIdentityForPlan(billing)),
  );

  return (
    <section className="hand-drawn-border bg-card p-6 grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-hand text-3xl font-bold">{t("planTitle")}</h2>
        {billing.liveSince && (
          <span className="font-label text-sm text-muted-foreground">
            {tp("liveSinceShort", { date: shortDate(billing.liveSince) })}
          </span>
        )}
      </div>

      {line.amountCents !== null && line.interval !== null ? (
        <p className="font-hand text-3xl font-bold">
          {tp("amountLine", {
            amount: eur(line.amountCents),
            interval: tp(`interval.${intervalKeyOf(line.interval)}`),
          })}
        </p>
      ) : (
        <p className="font-label text-muted-foreground">{tp("noPlan")}</p>
      )}

      <PartnerPlanAction
        locale={locale}
        state={line.state}
        billingId={billing.id}
        invoiceable={invoiceable}
        nextCharge={sub ? nextChargeDate(sub.startDate, sub.interval, new Date()) : null}
      />

      <p className="font-label text-sm text-muted-foreground">{t("planNote")}</p>
    </section>
  );
}
