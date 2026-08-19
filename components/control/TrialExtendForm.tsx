"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { extendTrialAction, type ExtendTrialState } from "@/lib/actions/billing-trial-actions";
import ActionError from "./ActionError";

/**
 * Set or push out a plan's free period, with a reason.
 *
 * The reason is required, and is the point of the control rather than paperwork
 * around it: the column can only ever say *until when*, and "why is this tenant
 * still free in November" is the question that gets asked a quarter later, by
 * which time nobody remembers. It is written to the audit log with the from/to
 * dates (`billing.trial.extended`) — not to the plan, which no partner reads.
 *
 * A plain `<form action={...}>` with named fields: it works as an ordinary POST
 * with no JavaScript, which is the bar every server action in this app meets.
 */
export default function TrialExtendForm({
  billingId,
  min,
  max,
}: Readonly<{ billingId: string; min: string; max: string }>) {
  const t = useTranslations("control.admin.trial");
  const [state, action, pending] = useActionState<ExtendTrialState, FormData>(
    extendTrialAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:max-w-md">
      <input type="hidden" name="billingId" value={billingId} />
      <label className="grid gap-1 font-label text-sm">
        {t("dateLabel")}
        <input
          type="date"
          name="trialEndsAt"
          required
          min={min}
          max={max}
          className="input-primary"
        />
      </label>
      <label className="grid gap-1 font-label text-sm">
        {t("reasonLabel")}
        <input
          name="reason"
          required
          minLength={3}
          maxLength={300}
          autoComplete="off"
          placeholder={t("reasonPlaceholder")}
          className="input-primary"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-secondary text-sm" disabled={pending}>
          {pending ? t("saving") : t("submit")}
        </button>
        {state.ok && (
          <span className="font-label text-sm text-craft-success-text">{t("saved")}</span>
        )}
      </div>
      <ActionError code={state.error} />
    </form>
  );
}
