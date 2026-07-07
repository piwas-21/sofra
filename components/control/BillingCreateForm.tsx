"use client";

import { useActionState } from "react";
import { createBillingAction, type BillingActionState } from "@/lib/actions/billing-actions";
import { ErrorMessage } from "./StatusMessage";
import CopyField from "./CopyField";

export default function BillingCreateForm({ disabled }: { disabled?: boolean }) {
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
        placeholder="Tenant slug (registry key, e.g. demo)"
        aria-label="Tenant slug"
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="name"
        required
        maxLength={200}
        placeholder="Billing name (restaurant / company)"
        aria-label="Billing name"
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="email"
        type="email"
        required
        maxLength={200}
        placeholder="Billing email"
        aria-label="Billing email"
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="description"
        required
        maxLength={200}
        placeholder="Plan description (e.g. 'Sofra Core — monthly')"
        aria-label="Plan description"
        className="input-primary"
        disabled={disabled}
      />
      <input
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        required
        placeholder="Amount per period (EUR)"
        aria-label="Amount per period in EUR"
        className="input-primary"
        disabled={disabled}
      />
      <select
        name="interval"
        aria-label="Billing interval"
        className="input-primary"
        defaultValue="month"
        disabled={disabled}
      >
        <option value="month">Monthly</option>
        <option value="quarter">Quarterly</option>
        <option value="year">Yearly</option>
      </select>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending || disabled}
          className="btn-primary disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create + get checkout link"}
        </button>
        <ErrorMessage>{state.error}</ErrorMessage>
      </div>
      {state.ok && (
        <div className="sm:col-span-2 grid gap-2">
          <span className="font-label text-craft-success-text dark:text-craft-success">
            Created. Send the tenant this first-payment link (also on the detail page):
          </span>
          {state.checkoutUrl ? (
            <CopyField value={state.checkoutUrl} />
          ) : (
            <span className="font-label text-sm text-muted-foreground">
              No checkout link returned — check the detail page.
            </span>
          )}
        </div>
      )}
    </form>
  );
}
