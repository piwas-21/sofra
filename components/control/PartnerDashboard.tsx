import { getTranslations } from "next-intl/server";
import { eur, shortDate } from "@/lib/format";
import { intervalKeyOf, planState } from "@/lib/billing-display";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";
import { loadTenantRegistry, type RegistryResult } from "@/lib/tenant-registry";
import { clientRowSummary, type ClientRowSummary } from "@/lib/client-tenant";
import type { BillingIdentity } from "@/lib/generated/prisma/client";
import ClientForm from "./ClientForm";
import ClientStatusBadge from "./ClientStatusBadge";
import ClientRowLine from "./ClientRowLine";
import PartnerPlanAction from "./PartnerPlanAction";

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
  client: { id: string; restaurantName: string; partnerId: string } | null;
  subscriptions: { amountCents: number; interval: string; status: string }[];
  payments: { sequenceType: string; status: string }[];
};

type PartnerClient = {
  id: string;
  restaurantName: string;
  city: string | null;
  contactName: string | null;
  status: string;
  /** Set by the founder once the tenant is provisioned — the join to the registry. */
  tenantSlug: string | null;
  updatedAt: Date;
};

/**
 * The registry once per render, for the tenant line on every client row.
 *
 * Read here rather than in `page.tsx` so the owner view never pays for it. Failure is
 * not surfaced: a partner cannot act on an unreadable registry mount, and
 * `clientRowSummary` already degrades every row to "no tenant facts" — the founder
 * gets the error loudly on /admin/tenants.
 */
async function rowSummaries(
  clients: PartnerClient[],
  billings: PartnerBilling[],
): Promise<Map<string, ClientRowSummary>> {
  const registry: RegistryResult = await loadTenantRegistry();
  const billingByClient = new Map(
    billings.flatMap((b) => (b.client ? [[b.client.id, b] as const] : [])),
  );
  return new Map(
    clients.map((c) => [
      c.id,
      clientRowSummary({
        status: c.status,
        tenantSlug: c.tenantSlug,
        registry,
        billing: billingByClient.get(c.id),
      }),
    ]),
  );
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

  // Tenant + plan facts per row (SOFRA-PARTNER-PLAN §9). One registry read and one
  // map, so the list stays a single query path however many clients a partner holds.
  const summaries = await rowSummaries(clients, billings);

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
            {/* The shared reseller plan control — the same one the client page renders,
                so the two surfaces can never disagree about the "processing" window. */}
            <PartnerPlanAction
              locale={locale}
              state={planState(sub, b.payments)}
              billingId={b.id}
              invoiceable={invoiceableByPlan.get(b.id) ?? false}
              nextCharge={null}
            />
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
                  <span className="font-label text-sm text-muted-foreground block">
                    {[c.city, c.contactName].filter(Boolean).join(" · ") || "—"} ·{" "}
                    {t("updated", { date: shortDate(c.updatedAt) })}
                  </span>
                  {/* The tenant line: what this client actually has, and what it costs.
                      Plain text, not a link — the whole row is already an anchor. */}
                  <ClientRowLine locale={locale} summary={summaries.get(c.id)} />
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
