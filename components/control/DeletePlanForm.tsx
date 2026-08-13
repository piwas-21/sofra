"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { deleteBillingPlanAction, type DeletePlanState } from "@/lib/actions/plan-delete-actions";
import ActionError from "./ActionError";

/**
 * Delete a billing plan — the only destructive control in the admin.
 *
 * Two things make it deliberately awkward, and both are on purpose:
 *
 *  • It is **collapsed behind a toggle**, so it is never one stray click away
 *    from a plan you were only reading.
 *  • It requires the tenant slug to be **typed**. The id travels in a hidden
 *    field, so without this the difference between deleting the right row and
 *    the wrong one is which page you happened to be on.
 *
 * The server re-checks everything (`planDeletionVerdict`); this is friction, not
 * the guard. `blocked` only decides whether to offer the control at all — a plan
 * carrying invoices or settled money is refused server-side regardless.
 */
export default function DeletePlanForm({
  billingId,
  tenantSlug,
  blockedReason,
}: Readonly<{ billingId: string; tenantSlug: string; blockedReason?: string }>) {
  const t = useTranslations("control.admin.planDelete");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DeletePlanState, FormData>(
    deleteBillingPlanAction,
    {},
  );

  if (state.ok) {
    return (
      <p className="font-label text-sm text-craft-success-text">
        {t("deleted", { slug: state.deletedSlug ?? tenantSlug })}
      </p>
    );
  }

  // Refused before it is offered — and it SAYS why, because "this plan cannot be
  // deleted" without a reason is the kind of message that sends someone to psql.
  if (blockedReason) {
    return (
      <p className="font-label text-sm text-muted-foreground">
        {t(`blocked.${blockedReason}`)}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-label text-sm underline">
        {t("reveal")}
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-2">
      <p className="font-label text-sm text-craft-error-text">{t("warning")}</p>
      <input type="hidden" name="billingId" value={billingId} />
      <label className="grid gap-1 font-label text-sm">
        {t("confirmLabel", { slug: tenantSlug })}
        <input
          name="confirmSlug"
          required
          autoComplete="off"
          placeholder={tenantSlug}
          aria-label={t("confirmLabel", { slug: tenantSlug })}
          className="input-primary"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-secondary text-sm" disabled={pending}>
          {pending ? t("deleting") : t("confirm")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="font-label text-sm underline">
          {t("cancel")}
        </button>
      </div>
      <ActionError code={state.error} />
    </form>
  );
}
