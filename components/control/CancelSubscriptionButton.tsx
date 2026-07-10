"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { cancelSubscriptionAction, type BillingActionState } from "@/lib/actions/billing-actions";
import ActionError from "./ActionError";

export default function CancelSubscriptionButton({ id }: { id: string }) {
  const t = useTranslations("control.admin.billingDetail");
  const [state, action, pending] = useActionState<BillingActionState, FormData>(
    cancelSubscriptionAction,
    {},
  );

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t("cancelConfirm"))) {
          e.preventDefault();
        }
      }}
      className="flex items-center gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
        {pending ? t("cancelling") : t("cancel")}
      </button>
      <ActionError code={state.error} />
    </form>
  );
}
