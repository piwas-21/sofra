"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  applyPartnerBrandAction,
  type PartnerBrandApplyState,
} from "@/lib/actions/partner-brand-apply-actions";
import ActionError from "./ActionError";

export function PartnerBrandApplyFeedback({
  state,
}: Readonly<{ state: PartnerBrandApplyState }>) {
  const t = useTranslations("control.brand");

  return (
    <>
      {state.outcome === "proposed" && (
        <p className="font-label text-sm text-muted-foreground">
          {state.optedOut ? t("removalAwaitingDeployment") : t("changesAwaitingDeployment")}
        </p>
      )}
      {state.outcome === "pending" && (
        <p className="font-label text-sm text-muted-foreground">{t("changesAwaitingReview")}</p>
      )}
      {state.outcome === "unchanged" && (
        <p className="font-label text-sm text-muted-foreground">
          {state.optedOut ? t("tenantOptedOut") : t("alreadyApplied")}
        </p>
      )}
      {state.prUrl && (
        <a href={state.prUrl} target="_blank" rel="noreferrer" className="font-label text-sm underline">
          {t("viewProposal")}
        </a>
      )}
      <ActionError code={state.error} />
    </>
  );
}

export default function PartnerBrandApplyForm({ clientId }: Readonly<{ clientId: string }>) {
  const t = useTranslations("control.brand");
  const [state, action, pending] = useActionState<PartnerBrandApplyState, FormData>(
    applyPartnerBrandAction,
    {},
  );

  return (
    <div className="grid justify-items-start gap-2">
      <form action={action}>
        <input type="hidden" name="clientId" value={clientId} />
        <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {pending ? t("applying") : t("applyToSite")}
        </button>
      </form>
      <PartnerBrandApplyFeedback state={state} />
    </div>
  );
}
