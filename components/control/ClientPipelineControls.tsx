"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  setClientStatusAction,
  requestOnboardingAction,
  type PartnerActionState,
} from "@/lib/actions/partner-actions";
import ActionError from "./ActionError";

const PARTNER_STATUSES = [
  ["LEAD", "lead"],
  ["CONTACTED", "contacted"],
  ["DEMO_SCHEDULED", "demoScheduled"],
  ["AGREED", "agreed"],
] as const;

/** Status stepper + "request onboarding", shown while the partner still owns
 *  the pipeline (server rejects changes once SofraPiwas takes over). */
export default function ClientPipelineControls({
  clientId,
  status,
}: {
  clientId: string;
  status: string;
}) {
  const t = useTranslations("control.pipeline");
  const tStatus = useTranslations("control.status");
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
        {status === "ONBOARDING" ? t("onboardingRequested") : t("managedBySofra")}
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
          aria-label={t("statusAria")}
          className="input-primary max-w-60"
        >
          {PARTNER_STATUSES.map(([value, key]) => (
            <option key={value} value={value}>
              {tStatus(key)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={statusPending} className="btn-secondary disabled:opacity-60">
          {statusPending ? t("updating") : t("update")}
        </button>
        <ActionError code={statusState.error} />
      </form>

      <form action={onboardAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={clientId} />
        <button
          type="submit"
          disabled={onboardPending || status !== "AGREED"}
          className="btn-primary disabled:opacity-60"
          title={status !== "AGREED" ? t("moveToAgreed") : undefined}
        >
          {onboardPending ? t("sending") : t("requestOnboarding")}
        </button>
        <span className="font-label text-sm text-muted-foreground">{t("sofraSetsUp")}</span>
        <ActionError code={onboardState.error} />
      </form>
    </div>
  );
}
