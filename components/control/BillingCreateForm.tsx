"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createBillingAction, type BillingActionState } from "@/lib/actions/billing-actions";
import ActionError from "./ActionError";
import CopyField from "./CopyField";

export default function BillingCreateForm({ disabled }: { disabled?: boolean }) {
  const t = useTranslations("control.admin");
  const [state, action, pending] = useActionState<BillingActionState, FormData>(
    createBillingAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input
        name="tenantSlug"
        required
        pattern="[a-z0-9][a-z0-9-]{1,30}"
        placeholder={t("billingForm.slug")}
        aria-label={t("billingForm.slugAria")}
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="name"
        required
        maxLength={200}
        placeholder={t("billingForm.name")}
        aria-label={t("billingForm.nameAria")}
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="email"
        type="email"
        required
        maxLength={200}
        placeholder={t("billingForm.email")}
        aria-label={t("billingForm.email")}
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="description"
        required
        maxLength={200}
        placeholder={t("billingForm.description")}
        aria-label={t("billingForm.descriptionAria")}
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        required
        placeholder={t("billingForm.amount")}
        aria-label={t("billingForm.amountAria")}
        className="input-primary"
        disabled={disabled}
      />
      <select
        name="interval"
        aria-label={t("billingForm.intervalAria")}
        className="input-primary"
        defaultValue="month"
        disabled={disabled}
      >
        <option value="month">{t("intervals.month")}</option>
        <option value="quarter">{t("intervals.quarter")}</option>
        <option value="year">{t("intervals.year")}</option>
      </select>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending || disabled}
          className="btn-primary disabled:opacity-60"
        >
          {pending ? t("billingForm.creating") : t("billingForm.create")}
        </button>
        <ActionError code={state.error} />
      </div>
      {state.ok && (
        <div className="sm:col-span-2 grid gap-2">
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("billingForm.created")}
          </span>
          {state.checkoutUrl ? (
            <CopyField value={state.checkoutUrl} />
          ) : (
            <span className="font-label text-sm text-muted-foreground">
              {t("billingForm.noCheckout")}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
