import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { isPaymentsPending } from "@/lib/payments-pending";
import { tenantStage } from "@/lib/tenant-liveness";
import { probeTenantHealthy } from "@/lib/tenant-health";
import OwnerPlanCard from "./OwnerPlanCard";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";
import type { BillingIdentity } from "@/lib/generated/prisma/client";

/**
 * The restaurant owner's dashboard (SOFRA-ONBOARDING-PLAN O4).
 *
 * Shows EVERY plan they pay for, not only the ones "awaiting attention" — that filter
 * is what left an owner with an active subscription reading one sentence and no
 * numbers. Each plan carries the panel that says where their app is and how to get
 * into it, which is the piece O3 handed over.
 */

type PaymentRow = {
  id: string;
  billingId: string;
  createdAt: Date;
  sequenceType: string;
  status: string;
  amountCents: number;
};

type OwnerBilling = {
  id: string;
  tenantSlug: string;
  liveSince: Date | null;
  /** The free period's end. Null on every self-serve plan by policy (T2). */
  trialEndsAt: Date | null;
  provisioningPrUrl: string | null;
  // The three `resolveIdentityForPlan` reads, so invoiceability is decided the
  // same way here as in the gate and the write.
  billingIdentityId: string | null;
  payerUserId: string | null;
  billingIdentity: BillingIdentity | null;
  client: ({ restaurantName: string } & { partnerId: string }) | null;
  subscriptions: { status: string; amountCents: number; interval: string; startDate: Date | null }[];
  payments: { sequenceType: string; status: string }[];
  /** The lead this plan was minted from — null on the founder-created path (O7 P4). */
  signupRequest: { modules: string | null } | null;
};

/** Newest payments shown in an owner's history, per plan. */
const HISTORY_LIMIT = 10;

/**
 * Ceiling on the rows the history query may read, across every plan the owner holds.
 *
 * The cap exists so the query cannot grow with the age of an account, not because the
 * number is meaningful: an owner holds ONE plan in practice (the self-serve signup
 * mints exactly one), so 100 rows is over eight years of monthly charges for the
 * realistic case and the slice below is exact.
 *
 * The one case where it is lossy is stated rather than hidden: an owner holding several
 * plans, one of them far busier, could see the quiet plan's history thinned — the rows
 * are taken newest-first across all of them. That is display-only history on a page
 * whose purpose is the CURRENT plan, and the alternative (a query per plan) is the
 * N+1 this replaced.
 */
const HISTORY_ROW_CAP = 100;

/**
 * The newest payments for every plan in one round trip, grouped by plan.
 *
 * Prisma has no per-group limit, so the slice happens in memory. Ordering is done by
 * the database and preserved by `Map`/array insertion order, so each plan's list stays
 * newest-first without a second sort.
 */
async function paymentHistory(billingIds: string[]) {
  if (billingIds.length === 0) return new Map<string, PaymentRow[]>();
  const rows = await db.billingPayment.findMany({
    where: { billingId: { in: billingIds } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_ROW_CAP,
  });
  const byBilling = new Map<string, PaymentRow[]>();
  for (const row of rows) {
    const list = byBilling.get(row.billingId) ?? [];
    if (list.length < HISTORY_LIMIT) list.push(row);
    byBilling.set(row.billingId, list);
  }
  return byBilling;
}

/**
 * The registry entry for each slug this owner holds, and whether the registry could be
 * read at all.
 *
 * An unreadable registry degrading to "no domain" is the fail-closed direction here:
 * `tenantStage` then cannot reach "ready", so the worst case is a live owner briefly
 * told their app is still being set up. The alternative — surfacing the registry read
 * error on a customer's dashboard — reports one of our ops conditions to somebody who
 * cannot act on it, and the founder already gets it loudly on `/admin/provision`.
 *
 * `ok` is returned alongside the map rather than folded into it because P4 needs the
 * two apart: "no entry" and "could not look" produce the same empty map and must
 * produce different copy — see `isPaymentsPending`.
 */
async function registryEntries(
  slugs: string[],
): Promise<{ ok: boolean; bySlug: Map<string, { domain: string; modules: string[] }> }> {
  if (slugs.length === 0) return { ok: true, bySlug: new Map() };
  const registry = await loadTenantRegistry();
  if (!registry.ok) return { ok: false, bySlug: new Map() };
  const wanted = new Set(slugs);
  return {
    ok: true,
    bySlug: new Map(
      registry.tenants
        .filter((t) => wanted.has(t.slug))
        .map((t) => [t.slug, { domain: t.domain, modules: t.modules }]),
    ),
  };
}

export default async function OwnerDashboard({
  locale,
  ownerName,
  billings,
}: {
  readonly locale: string;
  readonly ownerName: string;
  readonly billings: OwnerBilling[];
}) {
  const t = await getTranslations({ locale, namespace: "control.dashboard" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });
  const registry = await registryEntries(billings.map((b) => b.tenantSlug));

  // ONE history query for every plan, grouped in memory — not one per row. The probe
  // is what this render can actually wait on (3s cap, 60s cache per domain), so the
  // queries should not add round-trips on top of it.
  const historyByBilling = await paymentHistory(billings.map((b) => b.id));

  // Whether each plan has the legal details an invoice needs. Resolved through
  // `resolveIdentityForPlan` — the SAME path the payment gate and the write use,
  // so the card cannot offer a pay button the gate will refuse.
  //
  // Short-circuits on the identity already loaded by the query, and resolves the
  // party at most once: every plan of one payer resolves to the same row, so a
  // per-plan lookup would be N identical queries. Same shape as the other two
  // payment surfaces.
  const invoiceableByPlan = new Map<string, boolean>();
  let partyIdentity: Awaited<ReturnType<typeof resolveIdentityForPlan>> | undefined;
  for (const b of billings) {
    const identity = b.billingIdentity ?? (partyIdentity ??= await resolveIdentityForPlan(b));
    invoiceableByPlan.set(b.id, isInvoiceable(identity));
  }

  const cards = await Promise.all(
    billings.map(async (b) => {
      const entry = registry.bySlug.get(b.tenantSlug);
      const domain = entry?.domain ?? null;
      return {
        billing: b,
        domain,
        paymentsPending: isPaymentsPending({
          purchased: b.signupRequest?.modules,
          granted: entry?.modules,
          registryReadable: registry.ok,
        }),
        history: historyByBilling.get(b.id) ?? [],
        stage: tenantStage({
          // Read from the SAME `first`-scoped payment window planState uses, so the
          // panel and the plan status can never disagree about whether money moved.
          paid: b.payments.some((p) => p.sequenceType === "first" && p.status === "paid"),
          provisioningPrUrl: b.provisioningPrUrl,
          registryDomain: domain,
          // `tenantSlug` is unique, so no two plans share a domain and this is one
          // probe per plan however the loop is written.
          healthy: domain ? await probeTenantHealthy(domain) : false,
        }),
      };
    }),
  );

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("ownerTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("ownerIntro")}</p>
      </div>

      {cards.length === 0 ? (
        <p className="font-hand text-2xl text-muted-foreground">{tp("noPlan")}</p>
      ) : (
        cards.map(({ billing, domain, history, stage, paymentsPending }) => (
          <OwnerPlanCard
            key={billing.id}
            locale={locale}
            billingId={billing.id}
            restaurant={billing.client?.restaurantName ?? billing.tenantSlug}
            ownerName={ownerName}
            subscription={billing.subscriptions[0] ?? null}
            firstPayments={billing.payments}
            history={history}
            liveSince={billing.liveSince}
            trialEndsAt={billing.trialEndsAt}
            invoiceable={invoiceableByPlan.get(billing.id) ?? false}
            stage={stage}
            tenantDomain={domain}
            paymentsPending={paymentsPending}
          />
        ))
      )}
    </div>
  );
}
