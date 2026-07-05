"use client";

import { useActionState } from "react";
import { addCommissionAction, type AdminActionState } from "@/lib/actions/admin-actions";
import { ErrorMessage } from "./StatusMessage";

export default function CommissionForm({
  partnerId,
  clients,
}: {
  partnerId: string;
  clients: { id: string; restaurantName: string }[];
}) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    addCommissionAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="partnerId" value={partnerId} />
      <input
        name="amount"
        type="number"
        step="0.05"
        required
        placeholder="Amount (CHF, negative = payout)"
        aria-label="Amount in CHF"
        className="input-primary"
      />
      <select name="clientId" aria-label="Related client" className="input-primary" defaultValue="">
        <option value="">No specific client</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.restaurantName}
          </option>
        ))}
      </select>
      <input
        name="note"
        required
        maxLength={500}
        placeholder="Note (e.g. 'RUMI onboarding bonus', 'March payout')"
        aria-label="Note"
        className="input-primary sm:col-span-2"
      />
      <div className="sm:col-span-2 flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Recording…" : "Record entry"}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">Recorded.</span>
        )}
        <ErrorMessage>{state.error}</ErrorMessage>
      </div>
    </form>
  );
}
