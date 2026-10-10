"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { applyPartnerBrandAction, type PartnerBrandApplyState } from "@/lib/actions/partner-brand-apply-actions";
import ActionError from "./ActionError";

export function PartnerBrandApplyFeedback({ state }: Readonly<{ state: PartnerBrandApplyState }>) {
  const t = useTranslations("control.brand");
  return (
    <>
      {state.ok && <output className="block font-label text-sm text-muted-foreground">
        {state.optedOut ? t("tenantOptedOut") : t("runtimeSaved")}
      </output>}
      <ActionError code={state.error} />
    </>
  );
}

export default function PartnerBrandApplyForm({ clientId, enabled, publishable, optedOut }: Readonly<{
  clientId: string; enabled: boolean; publishable: boolean; optedOut: boolean;
}>) {
  const t = useTranslations("control.brand");
  const [state, action, pending] = useActionState<PartnerBrandApplyState, FormData>(applyPartnerBrandAction, {});
  const visible = state.enabled ?? enabled;
  function statusText() {
    if (optedOut) return t("tenantOptedOut");
    if (!visible) return t("runtimeHidden");
    if (!publishable) return t("runtimeUnpublished");
    return t("runtimeEnabled");
  }
  return (
    <div className="grid justify-items-start gap-2">
      <p className="font-label text-sm text-muted-foreground">
        {statusText()}
      </p>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="clientId" value={clientId} />
        <button name="enabled" value="true" type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {t("runtimeShow")}
        </button>
        <button name="enabled" value="false" type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {t("hideOnSite")}
        </button>
      </form>
      <PartnerBrandApplyFeedback state={state} />
    </div>
  );
}
