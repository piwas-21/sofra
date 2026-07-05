"use client";

import { useActionState } from "react";
import {
  setClientLiveAction,
  markClientChurnedAction,
  type AdminActionState,
} from "@/lib/actions/admin-actions";
import { ErrorMessage } from "./StatusMessage";

export default function SetLiveForm({
  clientId,
  status,
  tenantSlug,
}: {
  clientId: string;
  status: string;
  tenantSlug: string | null;
}) {
  const [liveState, liveAction, livePending] = useActionState<AdminActionState, FormData>(
    setClientLiveAction,
    {},
  );
  const [churnState, churnAction, churnPending] = useActionState<AdminActionState, FormData>(
    markClientChurnedAction,
    {},
  );

  if (status === "LIVE") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-xs bg-muted/60 rounded-craft px-2 py-1">{tenantSlug}</code>
        <form action={churnAction}>
          <input type="hidden" name="id" value={clientId} />
          <button
            type="submit"
            disabled={churnPending}
            className="font-label text-sm text-destructive underline disabled:opacity-60"
          >
            {churnPending ? "…" : "Mark churned"}
          </button>
        </form>
        <ErrorMessage>{churnState.error}</ErrorMessage>
      </div>
    );
  }

  return (
    <form action={liveAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={clientId} />
      <input
        name="tenantSlug"
        defaultValue={tenantSlug ?? ""}
        placeholder="tenant-slug"
        aria-label="Tenant slug"
        pattern="[a-z0-9][a-z0-9-]{1,60}"
        className="input-primary max-w-40 text-sm py-1.5"
      />
      <button type="submit" disabled={livePending} className="btn-secondary text-sm py-1.5 disabled:opacity-60">
        {livePending ? "…" : "Mark LIVE"}
      </button>
      <ErrorMessage>{liveState.error}</ErrorMessage>
    </form>
  );
}
