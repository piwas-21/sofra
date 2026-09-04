import { getTranslations } from "next-intl/server";
import { eur } from "@/lib/format";
import {
  ONLINE_PAYMENTS_PRICE_CENTS,
  crossoverCentsPerMonth,
  formatCommissionPercent,
  type PaymentsMode,
} from "@/lib/payments-pricing";
import { effectivePaymentsMode } from "@/lib/payments-mode-effective";
import { commissionEligibility } from "@/lib/commission-eligibility";
import type { RegistryTenant } from "@/lib/tenant-registry";
import PaymentsModeForm from "./PaymentsModeForm";

/**
 * One tenant's payments pricing mode (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2b) — the
 * owner's `/admin/billing/[id]` control. Server component: it renders the facts
 * the page already has and decides nothing about submission; `PaymentsModeForm`
 * is the only client code here.
 *
 * The headline figure is the EFFECTIVE mode (`effectivePaymentsMode`), never
 * `billingMode`/`billingBps` directly — those are only what we INTEND to bill,
 * and the plan is explicit that billing must follow what the box actually
 * enforces, not what Prisma alone says. `billingMode`/`billingBps` still drive
 * the FORM's defaults, because that is the value `updatePaymentsModeAction`
 * compares a new submission against.
 */
export default async function PaymentsModePanel({
  locale,
  tenantSlug,
  billingMode,
  billingBps,
  registryTenant,
  registryReadable,
}: {
  readonly locale: string;
  readonly tenantSlug: string;
  readonly billingMode: PaymentsMode;
  readonly billingBps: number;
  readonly registryTenant: RegistryTenant | undefined;
  readonly registryReadable: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "control.admin.paymentsMode" });

  const effective = effectivePaymentsMode({
    intended: billingMode,
    registryBps: registryTenant?.payments_commission_bps,
    registryReadable,
  });
  // The rate actually enforced, not necessarily the one we intend — mirrors how
  // `effectivePaymentsMode` itself falls back to the intent when the registry
  // cannot be read at all, so this can never disagree with `effective.mode`.
  const effectiveBps = registryReadable ? (registryTenant?.payments_commission_bps ?? 0) : billingBps;
  const crossover = crossoverCentsPerMonth(effectiveBps, ONLINE_PAYMENTS_PRICE_CENTS);
  const eligibility = commissionEligibility({ registryReadable, tenant: registryTenant });

  return (
    <section className="hand-drawn-border bg-card p-5">
      <h2 className="font-hand text-2xl font-bold">{t("title")}</h2>
      <p className="mt-1 font-label text-sm text-muted-foreground">
        {effective.mode === "commission"
          ? t("commissionSummary", { percent: formatCommissionPercent(effectiveBps) })
          : t("flatSummary")}
      </p>
      {effective.pending && (
        // <output>, not <p role="status">: it carries the same implicit ARIA role
        // while being the element browsers and assistive tech already understand
        // (Sonar S6819). `block` because <output> is inline by default and this is
        // a paragraph-shaped notice.
        <output className="mt-2 block font-label text-sm text-craft-warning-text dark:text-craft-warning">
          {t("pendingNote")}
        </output>
      )}
      {/* Render nothing numeric at 0 bps — commission costs nothing no matter the
          turnover, which is a different statement from "the crossover is very
          high" and must never be printed as one. */}
      {crossover !== null && (
        <p className="mt-2 font-label text-sm text-muted-foreground">
          {t("crossover", { percent: formatCommissionPercent(effectiveBps), amount: eur(crossover) })}
        </p>
      )}
      <div className="mt-4">
        <PaymentsModeForm
          tenantSlug={tenantSlug}
          currentMode={billingMode}
          currentBps={billingBps}
          eligibility={eligibility}
        />
      </div>
    </section>
  );
}
