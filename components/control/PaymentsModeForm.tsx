"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  updatePaymentsModeAction,
  type PaymentsModeActionState,
} from "@/lib/actions/provisioning-actions";
import {
  DEFAULT_COMMISSION_BPS,
  MAX_COMMISSION_BPS,
  ONLINE_PAYMENTS_PRICE_CENTS,
  crossoverCentsPerMonth,
  formatCommissionPercent,
  type PaymentsMode,
} from "@/lib/payments-pricing";
import { eur } from "@/lib/format";
import type { CommissionEligibility } from "@/lib/commission-eligibility";
import ActionError from "./ActionError";

/**
 * Set a tenant's payments mode + rate, submitting to `updatePaymentsModeAction`
 * (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2b) — which opens/updates a registry PR, it
 * does not flip anything live (see the pending note above this form).
 *
 * A plain `<form action={...}>`, same as every other server-action form in this
 * app: it works as an ordinary POST with no JavaScript. The mode/rate state here
 * is a CONVENIENCE on top of that, not a replacement — an admin with no
 * JavaScript sees the same two fields, pre-filled with the tenant's current
 * intent, and can still type a new mode/rate directly; JS only adds the live
 * crossover preview and a sensible default when switching TO commission.
 * The rate field is never `disabled`: a disabled input is dropped from the
 * submitted `FormData` entirely, which would break `mode=flat` submissions the
 * moment the rate field was left at a stale non-zero value — so ineligibility
 * disables only the COMMISSION RADIO itself, never the rate field.
 */
export default function PaymentsModeForm({
  tenantSlug,
  currentMode,
  currentBps,
  eligibility,
}: Readonly<{
  tenantSlug: string;
  currentMode: PaymentsMode;
  currentBps: number;
  eligibility: CommissionEligibility;
}>) {
  const t = useTranslations("control.admin.paymentsMode");
  const [state, action, pending] = useActionState<PaymentsModeActionState, FormData>(
    updatePaymentsModeAction,
    {},
  );
  const [mode, setMode] = useState<PaymentsMode>(currentMode);
  // The RAW current rate, never defaulted here — a no-op resubmit (admin clicks
  // Save without changing anything) must post exactly what is already stored, or
  // a flat tenant (bps 0, the overwhelming common case) would fail the server's
  // own "flat mode carries no commission rate" check on every unchanged save.
  // DEFAULT_COMMISSION_BPS only ever applies inside `handleModeChange`, on an
  // ACTIVE switch to commission — matching the plan's own instruction.
  const [bps, setBps] = useState<number>(currentBps);

  // A radio the admin cannot currently pick MAY still be the one already in
  // effect (an entry can become ineligible AFTER being switched — its account
  // could be removed by hand) — so only a NEW selection is refused, never the
  // tenant's own current mode, or there would be no way left to move it back.
  const commissionDisabled = !eligibility.eligible && currentMode !== "commission";

  const handleModeChange = (next: PaymentsMode) => {
    setMode(next);
    if (next === "flat") setBps(0);
    else if (bps === 0) setBps(DEFAULT_COMMISSION_BPS);
  };

  const preview = mode === "commission" ? crossoverCentsPerMonth(bps, ONLINE_PAYMENTS_PRICE_CENTS) : null;

  return (
    <form action={action} className="grid gap-3 sm:max-w-md">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <fieldset className="grid gap-2">
        <legend className="font-label text-sm text-muted-foreground">{t("modeLabel")}</legend>
        <label className="flex items-center gap-2 font-label text-sm">
          <input
            type="radio"
            name="mode"
            value="flat"
            checked={mode === "flat"}
            onChange={() => handleModeChange("flat")}
          />
          {t("modeFlat")}
        </label>
        <label className="flex items-center gap-2 font-label text-sm">
          <input
            type="radio"
            name="mode"
            value="commission"
            checked={mode === "commission"}
            disabled={commissionDisabled}
            onChange={() => handleModeChange("commission")}
          />
          {t("modeCommission")}
        </label>
        {!eligibility.eligible && (
          <p className="font-label text-sm text-craft-warning-text dark:text-craft-warning">
            {t(
              eligibility.reason === "registryUnavailable"
                ? "notEligibleRegistryUnavailable"
                : "notEligibleNotPaired",
            )}
          </p>
        )}
      </fieldset>
      <label className="grid gap-1 font-label text-sm">
        {t("rateLabel")}
        <input
          type="number"
          name="commissionBps"
          value={bps}
          onChange={(e) => setBps(Number(e.target.value) || 0)}
          min={0}
          max={MAX_COMMISSION_BPS}
          step={1}
          className="input-primary"
        />
        <span className="text-muted-foreground">{t("rateHint", { max: MAX_COMMISSION_BPS })}</span>
      </label>
      {preview !== null && (
        <p className="font-label text-sm text-muted-foreground">
          {t("crossover", { percent: formatCommissionPercent(bps), amount: eur(preview) })}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-secondary text-sm" disabled={pending}>
          {pending ? t("saving") : t("submit")}
        </button>
      </div>
      <ActionError code={state.error} />
      {state.ok && state.prUrl && (
        <div className="grid gap-1">
          <span className="font-label text-sm text-craft-success-text dark:text-craft-success">
            {t("prOpened")}
          </span>
          <a
            href={state.prUrl}
            target="_blank"
            rel="noreferrer"
            className="font-label text-sm underline break-all"
          >
            {state.prUrl}
          </a>
        </div>
      )}
      {state.ok && state.alreadySet && (
        <span className="font-label text-sm text-craft-success-text dark:text-craft-success">
          {t("alreadySet")}
        </span>
      )}
    </form>
  );
}
