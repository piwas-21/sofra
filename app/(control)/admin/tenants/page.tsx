import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur } from "@/lib/format";
import { BILLING_INTERVALS } from "@/lib/billing";
import {
  loadTenantRegistry,
  missingPairedStripeAccount,
  type RegistryTenant,
} from "@/lib/tenant-registry";
import { effectivePaymentsMode } from "@/lib/payments-mode-effective";
import { asPaymentsMode, formatCommissionPercent } from "@/lib/payments-pricing";

// The registry file changes underneath us (rsync on deploy-repo push) — always
// re-read instead of serving a build-time snapshot.
export const dynamic = "force-dynamic";

// Same shape/helper as the sibling /admin/billing page.
type BillingSummary = {
  id: string;
  subscriptions: { status: string; amountCents: number; interval: string }[];
  paymentsMode: string;
  paymentsCommissionBps: number;
};

// Shape of the "control.admin" translator handed down to the row helpers.
type Translator = (key: string, values?: Record<string, string | number>) => string;

const intervalKey = (mollie: string) =>
  Object.entries(BILLING_INTERVALS).find(([, i]) => i.mollie === mollie)?.[0];

function statusTone(status: string) {
  if (status === "active") return "text-craft-success-text dark:text-craft-success";
  if (status === "retired") return "text-muted-foreground";
  return ""; // provisioning et al — default ink
}

function BillingCell({ billing, t }: { billing?: BillingSummary; t: Translator }) {
  if (!billing) {
    return <span className="text-muted-foreground">{t("tenants.noBilling")}</span>;
  }
  const active = billing.subscriptions.filter((s) => s.status === "ACTIVE");
  const pending = billing.subscriptions.filter((s) => s.status !== "ACTIVE" && s.status !== "CANCELED");
  return (
    <Link href={`/admin/billing/${billing.id}`} className="underline">
      {active.length > 0
        ? active
            .map((s) => {
              const key = intervalKey(s.interval);
              return `${eur(s.amountCents)} · ${key ? t(`intervals.${key}`) : s.interval}`;
            })
            .join(", ")
        : pending.length > 0
          ? t("tenants.awaitingActivation", { count: pending.length })
          : t("tenants.noActivePlan")}
    </Link>
  );
}

/**
 * Read-only payments-mode label (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2b) — the
 * EFFECTIVE mode, derived the same way the billing page's own panel derives it,
 * never `billing.paymentsMode` alone: this page's whole reason to exist is
 * showing what the box actually enforces, and the control that CHANGES it lives
 * on `/admin/billing/[id]`, not here.
 */
function paymentsModeLabel(tenant: RegistryTenant, billing: BillingSummary | undefined, t: Translator) {
  const intended = billing ? asPaymentsMode(billing.paymentsMode) : "flat";
  const effective = effectivePaymentsMode({
    intended,
    registryBps: tenant.payments_commission_bps,
    registryReadable: true, // this page only ever renders inside the registry.ok branch
  });
  const base =
    effective.mode === "commission"
      ? t("tenants.paymentsModeCommission", { percent: formatCommissionPercent(tenant.payments_commission_bps ?? 0) })
      : t("tenants.paymentsModeFlat");
  return effective.pending ? `${base} ${t("tenants.paymentsModePending")}` : base;
}

function TenantCard({
  tenant,
  billing,
  t,
}: {
  tenant: RegistryTenant;
  billing?: BillingSummary;
  t: Translator;
}) {
  return (
    <li className="hand-drawn-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="font-hand text-2xl font-bold">{tenant.slug}</span>
          <span className={`ml-3 font-label text-sm ${statusTone(tenant.status)}`}>
            {tenant.status}
          </span>
          {tenant.managed === "legacy" && (
            <span className="ml-2 font-label text-sm text-muted-foreground">
              {t("tenants.legacy")}
            </span>
          )}
          <span className="font-label text-sm text-muted-foreground block">
            {tenant.name}
            {tenant.city ? ` · ${tenant.city}` : ""} ·{" "}
            <a href={`https://${tenant.domain}`} className="underline" target="_blank" rel="noreferrer">
              {tenant.domain}
            </a>{" "}
            · {t("tenants.box", { box: tenant.box })} · {t("tenants.db", { db: tenant.db })}
          </span>
        </span>
        <span className="font-label text-sm text-right">
          <span className="block">
            <BillingCell billing={billing} t={t} />
          </span>
          <span className="block text-muted-foreground">
            {tenant.currency ?? "EUR"} · {t("tenants.langCount", { count: tenant.languages.length })}{" "}
            · {t("tenants.modules", { list: tenant.modules.join(", ") || "—" })} ·{" "}
            {/* classic/craft is a technical identifier — rendered raw like status */}
            {t("tenants.template", { template: tenant.template ?? "classic" })}
          </span>
          <span className="block text-muted-foreground">{paymentsModeLabel(tenant, billing, t)}</span>
          {/* An `acct_…` is a Stripe identifier, not a secret, and it is the one
              fact that says whether this tenant can take a card at all. */}
          {tenant.stripe_account && (
            <span className="block text-muted-foreground">
              {t("tenants.stripeAccount", { account: tenant.stripe_account })}
            </span>
          )}
        </span>
      </div>
      {missingPairedStripeAccount(tenant) && (
        <p role="alert" className="mt-3 font-label text-sm text-craft-error-text">
          {t("tenants.stripeAccountMissing")}
        </p>
      )}
    </li>
  );
}

export default async function AdminTenantsPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });
  const registry = await loadTenantRegistry();
  const billings = await db.tenantBilling.findMany({
    select: {
      id: true,
      tenantSlug: true,
      subscriptions: { select: { status: true, amountCents: true, interval: true } },
      paymentsMode: true,
      paymentsCommissionBps: true,
    },
  });
  const billingBySlug = new Map(billings.map((b) => [b.tenantSlug, b]));

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("tenants.title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("tenants.intro")}</p>
      </div>

      {!registry.ok ? (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("tenants.unavailable", { error: registry.error })}
        </p>
      ) : (
        <section>
          <h2 className="font-hand text-3xl font-bold">
            {t("tenants.registered", { count: registry.tenants.length })}
          </h2>
          <ul className="mt-4 grid gap-4">
            {registry.tenants.map((tenant) => (
              <TenantCard
                key={tenant.slug}
                tenant={tenant}
                billing={billingBySlug.get(tenant.slug)}
                t={t}
              />
            ))}
            {registry.tenants.length === 0 && (
              <li className="font-label text-muted-foreground">{t("tenants.empty")}</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
