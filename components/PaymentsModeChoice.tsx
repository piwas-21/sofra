"use client";

import { useTranslations } from "next-intl";
import {
  DEFAULT_COMMISSION_BPS,
  ONLINE_PAYMENTS_PRICE_CENTS,
  crossoverCentsPerMonth,
  formatCommissionPercent,
  type PaymentsMode,
} from "@/lib/payments-pricing";
import { eur } from "@/lib/format";

/**
 * How to be charged for `online-payments`, offered on /signup
 * (SOFRA-PAYMENTS-PRICING-MODE-PLAN S3) — a flat monthly fee, or €0/mo plus a
 * per-transaction rate.
 *
 * Extracted out of `SignupConfigurator`, which sits at the CLAUDE.md §4
 * component limit and cannot grow — the same split `PaymentsModePanel` /
 * `PaymentsModeForm` already use for the equivalent `/admin/billing/[id]`
 * control (S2b). The parent still owns the `mode` state and folds it into the
 * running total via `paymentsModeQuote`, because that total lives beside the
 * OTHER modules' prices, not here.
 *
 * Renders NOTHING when `online-payments` is not selected: the choice is
 * meaningless without the module, and an always-visible control would imply
 * the module is included when it is not — the same reading
 * `sanitizeSignupConfiguration` gives it server-side (a mode with no module
 * degrades to `flat`).
 *
 * The rate shown is always {@link DEFAULT_COMMISSION_BPS} — a buyer picks the
 * MODE, never a number, same as the crossover sentence on `/admin/billing/[id]`
 * quotes the tenant's actual rate rather than letting an admin free-type one
 * that provisioning would refuse.
 *
 * One thing this control has to be honest about: a self-serve buyer has no
 * Stripe account yet — only the restaurant can create one, through Stripe's
 * own hosted onboarding, which cannot be pre-filled here. `provision-tenant.sh`
 * refuses `online-payments` without a `stripe_account`, so whatever is picked
 * below is a PREFERENCE recorded now; the module (and any rate with it) is
 * deferred to a second registry PR after that onboarding completes
 * (`splitDeferredModules`, mirrored on the admin side by `PaymentsPendingPanel`
 * / `isPaymentsPending`). `deferredNote` says that in the buyer's own words.
 */
export default function PaymentsModeChoice({
  hasOnlinePayments,
  mode,
  onChange,
}: Readonly<{
  hasOnlinePayments: boolean;
  mode: PaymentsMode;
  onChange: (mode: PaymentsMode) => void;
}>) {
  const t = useTranslations("signup.configurator.paymentsMode");
  if (!hasOnlinePayments) return null;

  // Render nothing numeric at 0 bps — commission would cost nothing no matter
  // the turnover, which `crossoverCentsPerMonth` distinguishes from "very
  // high" by returning null. DEFAULT_COMMISSION_BPS is never 0, so this is
  // reached in practice, but the guard stays the same shape as every other
  // caller of this function.
  const crossover = crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS, ONLINE_PAYMENTS_PRICE_CENTS);
  const percent = formatCommissionPercent(DEFAULT_COMMISSION_BPS);

  return (
    <fieldset className="hand-drawn-border bg-card p-4">
      <legend className="font-label px-1 text-sm text-muted-foreground">{t("title")}</legend>
      <div className="grid gap-2">
        <label className="flex items-start gap-2 font-label text-sm">
          <input
            type="radio"
            name="paymentsMode"
            value="flat"
            checked={mode === "flat"}
            onChange={() => onChange("flat")}
            className="mt-1 accent-primary"
          />
          <span>
            <span className="font-bold">
              {t("flatLabel", { price: eur(ONLINE_PAYMENTS_PRICE_CENTS) })}
            </span>
            <br />
            <span className="text-muted-foreground">{t("flatHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 font-label text-sm">
          <input
            type="radio"
            name="paymentsMode"
            value="commission"
            checked={mode === "commission"}
            onChange={() => onChange("commission")}
            className="mt-1 accent-primary"
          />
          <span>
            <span className="font-bold">{t("commissionLabel", { percent })}</span>
            <br />
            <span className="text-muted-foreground">{t("commissionHint")}</span>
          </span>
        </label>
      </div>
      {crossover !== null && (
        <p className="font-label text-xs text-muted-foreground mt-2">
          {t("crossover", { percent, amount: eur(crossover) })}
        </p>
      )}
      <p className="font-label text-xs text-muted-foreground mt-2">{t("deferredNote")}</p>
    </fieldset>
  );
}
