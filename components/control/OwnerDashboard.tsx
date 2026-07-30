import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { tenantStage } from "@/lib/tenant-liveness";
import { probeTenantHealthy } from "@/lib/tenant-health";
import OwnerPlanCard from "./OwnerPlanCard";

/**
 * The restaurant owner's dashboard (SOFRA-ONBOARDING-PLAN O4).
 *
 * Shows EVERY plan they pay for, not only the ones "awaiting attention" — that filter
 * is what left an owner with an active subscription reading one sentence and no
 * numbers. Each plan carries the panel that says where their app is and how to get
 * into it, which is the piece O3 handed over.
 */

type OwnerBilling = {
  id: string;
  tenantSlug: string;
  liveSince: Date | null;
  provisioningPrUrl: string | null;
  client: { restaurantName: string } | null;
  subscriptions: { status: string; amountCents: number; interval: string; startDate: Date | null }[];
  payments: { sequenceType: string; status: string }[];
};

/** Newest payments shown in an owner's history, per plan. */
const HISTORY_LIMIT = 10;

/**
 * The registry `domain` for each slug, or an empty map when the registry cannot be
 * read at all.
 *
 * An unreadable registry degrading to "no domain" is the fail-closed direction here:
 * `tenantStage` then cannot reach "ready", so the worst case is a live owner briefly
 * told their app is still being set up. The alternative — surfacing the registry read
 * error on a customer's dashboard — reports one of our ops conditions to somebody who
 * cannot act on it, and the founder already gets it loudly on `/admin/provision`.
 */
async function registryDomains(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const registry = await loadTenantRegistry();
  if (!registry.ok) return new Map();
  const wanted = new Set(slugs);
  return new Map(registry.tenants.filter((t) => wanted.has(t.slug)).map((t) => [t.slug, t.domain]));
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
  const domains = await registryDomains(billings.map((b) => b.tenantSlug));

  // One bounded history query per plan, and one health probe per plan that has a
  // domain. An owner holds exactly one plan in practice (the self-serve signup mints
  // one) and a handful at most, so the per-row queries are cheap — and unlike a single
  // shared `take`, one busy plan cannot starve another's history. The probe, not the
  // queries, is what this render can actually wait on: it is capped at 3s and cached
  // for 60s per domain, and `tenantSlug` is unique so no two plans share one anyway.
  const cards = await Promise.all(
    billings.map(async (b) => {
      const domain = domains.get(b.tenantSlug) ?? null;
      const [history, healthy] = await Promise.all([
        db.billingPayment.findMany({
          where: { billingId: b.id },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
        }),
        domain ? probeTenantHealthy(domain) : Promise.resolve(false),
      ]);
      return {
        billing: b,
        domain,
        history,
        stage: tenantStage({
          // Read from the SAME `first`-scoped payment window planState uses, so the
          // panel and the plan status can never disagree about whether money moved.
          paid: b.payments.some((p) => p.sequenceType === "first" && p.status === "paid"),
          provisioningPrUrl: b.provisioningPrUrl,
          registryDomain: domain,
          healthy,
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
        cards.map(({ billing, domain, history, stage }) => (
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
            stage={stage}
            tenantDomain={domain}
          />
        ))
      )}
    </div>
  );
}
