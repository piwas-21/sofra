"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { reissueInvoiceAction, type ReissueState } from "@/lib/actions/invoice-actions";
import ActionError from "./ActionError";

/**
 * Issue the invoice for a charge that settled without one.
 *
 * The failure it reports is the useful part: "still blocked, and here is which
 * cause is still unfixed" is what turns the not-invoiced list from a complaint
 * into a worklist.
 */
export default function ReissueInvoiceButton({
  molliePaymentId,
}: Readonly<{ molliePaymentId: string }>) {
  const t = useTranslations("control.admin.invoices");
  const [state, action, pending] = useActionState<ReissueState, FormData>(
    reissueInvoiceAction,
    {},
  );

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="molliePaymentId" value={molliePaymentId} />
      <button type="submit" className="btn-secondary text-sm" disabled={pending}>
        {pending ? t("issuing") : t("issueNow")}
      </button>
      {state.ok && <span className="font-mono text-sm">{state.number}</span>}
      <ActionError code={state.error} />
    </form>
  );
}
