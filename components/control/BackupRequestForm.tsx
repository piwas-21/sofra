"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestBackupAction, type BackupActionState } from "@/lib/actions/backup-actions";
import ActionError from "./ActionError";

/**
 * "Back up now" — one click, deliberately.
 *
 * The asymmetry with BackupDeleteForm is the safety design of this page, not an
 * oversight: taking an extra copy of data we already hold cannot lose anything,
 * so it gets no confirmation, no typing and no reason. Destroying one gets all
 * three, and is switched off by default.
 *
 * It does not take the backup. It queues a job the box collects on its next
 * poll (~5 min) — sofra holds no credential that can reach a box (ADR-012
 * invariant 2) — which is why the success copy says "queued", not "done".
 */
export default function BackupRequestForm({ tenantSlug }: Readonly<{ tenantSlug: string }>) {
  const t = useTranslations("control.admin.backups.create");
  const [state, action, pending] = useActionState<BackupActionState, FormData>(
    requestBackupAction,
    {},
  );

  if (state.ok) {
    return (
      <p className="font-label text-sm text-craft-success-text dark:text-craft-success">
        {t("queued", { slug: state.queuedSlug ?? tenantSlug })}
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <button type="submit" className="btn-secondary text-sm" disabled={pending}>
        {pending ? t("pending") : t("button")}
      </button>
      <ActionError code={state.error} />
    </form>
  );
}
