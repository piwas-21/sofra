"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { startPaymentAction, type StartPaymentState } from "@/lib/actions/partner-billing-actions";
import ActionError from "./ActionError";

/** Partner "Start auto-monthly payment" — the action redirects to Mollie on
 *  success, so this stays a plain progressively-enhanced form. */
export default function StartPaymentButton({ billingId }: Readonly<{ billingId: string }>) {
  const t = useTranslations("control.plan");
  const [state, action, pending] = useActionState<StartPaymentState, FormData>(
    startPaymentAction,
    {},
  );

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="billingId" value={billingId} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        {pending ? t("redirecting") : t("startPayment")}
      </button>
      <ActionError code={state.error} />
    </form>
  );
}
