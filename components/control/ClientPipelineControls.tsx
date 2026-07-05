"use client";

import { useActionState } from "react";
import {
  setClientStatusAction,
  requestOnboardingAction,
  type PartnerActionState,
} from "@/lib/actions/partner-actions";
import { ErrorMessage } from "./StatusMessage";

const PARTNER_STATUSES = [
  ["LEAD", "Lead"],
  ["CONTACTED", "Contacted"],
  ["DEMO_SCHEDULED", "Demo scheduled"],
  ["AGREED", "Agreed"],
] as const;

/** Status stepper + "request onboarding", shown while the partner still owns
 *  the pipeline (server rejects changes once Sofra takes over). */
export default function ClientPipelineControls({
  clientId,
  status,
}: {
  clientId: string;
  status: string;
}) {
  const [statusState, statusAction, statusPending] = useActionState<PartnerActionState, FormData>(
    setClientStatusAction,
    {},
  );
  const [onboardState, onboardAction, onboardPending] = useActionState<PartnerActionState, FormData>(
    requestOnboardingAction,
    {},
  );

  const locked = ["ONBOARDING", "LIVE", "CHURNED"].includes(status);
  if (locked) {
    return (
      <p className="font-label text-muted-foreground">
        {status === "ONBOARDING"
          ? "Onboarding requested — Sofra is on it. You'll see this go Live here."
          : "This client's status is managed by Sofra now."}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <form action={statusAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={clientId} />
        <select
          name="status"
          defaultValue={status}
          aria-label="Pipeline status"
          className="input-primary max-w-60"
        >
          {PARTNER_STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={statusPending} className="btn-secondary disabled:opacity-60">
          {statusPending ? "Updating…" : "Update status"}
        </button>
        <ErrorMessage>{statusState.error}</ErrorMessage>
      </form>

      <form action={onboardAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={clientId} />
        <button
          type="submit"
          disabled={onboardPending || status !== "AGREED"}
          className="btn-primary disabled:opacity-60"
          title={status !== "AGREED" ? "Move the client to Agreed first" : undefined}
        >
          {onboardPending ? "Sending…" : "Request onboarding 🍽"}
        </button>
        <span className="font-label text-sm text-muted-foreground">
          Sofra sets up the restaurant and flips it Live.
        </span>
        <ErrorMessage>{onboardState.error}</ErrorMessage>
      </form>
    </div>
  );
}
