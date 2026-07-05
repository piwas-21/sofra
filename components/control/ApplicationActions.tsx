"use client";

import { useActionState } from "react";
import {
  approveApplicationAction,
  rejectApplicationAction,
  type AdminActionState,
} from "@/lib/actions/admin-actions";
import { ErrorMessage } from "./StatusMessage";

export default function ApplicationActions({ id }: { id: string }) {
  const [approveState, approve, approving] = useActionState<AdminActionState, FormData>(
    approveApplicationAction,
    {},
  );
  const [rejectState, reject, rejecting] = useActionState<AdminActionState, FormData>(
    rejectApplicationAction,
    {},
  );

  if (approveState.ok) {
    return (
      <div className="grid gap-2">
        <p className="font-label text-craft-success-text dark:text-craft-success">
          Approved — invite emailed. Backup link (24h, single use):
        </p>
        <code className="font-mono text-xs break-all bg-muted/60 rounded-craft p-2">
          {approveState.inviteLink}
        </code>
      </div>
    );
  }
  if (rejectState.ok) {
    return <p className="font-label text-muted-foreground">Rejected.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={approve}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={approving || rejecting} className="btn-primary disabled:opacity-60">
          {approving ? "Approving…" : "Approve"}
        </button>
      </form>
      <form action={reject}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={approving || rejecting}
          className="btn-artisanal rounded-craft border-2 border-destructive text-destructive px-4 py-2 font-label disabled:opacity-60"
        >
          {rejecting ? "Rejecting…" : "Reject"}
        </button>
      </form>
      <ErrorMessage>{approveState.error ?? rejectState.error}</ErrorMessage>
    </div>
  );
}
