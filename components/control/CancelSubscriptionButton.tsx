"use client";

import { useActionState } from "react";
import { cancelSubscriptionAction, type BillingActionState } from "@/lib/actions/billing-actions";
import { ErrorMessage } from "./StatusMessage";

export default function CancelSubscriptionButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(
    cancelSubscriptionAction,
    {},
  );

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Cancel this subscription? Mollie stops charging immediately.")) {
          e.preventDefault();
        }
      }}
      className="flex items-center gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
