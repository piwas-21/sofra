"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  requestArtifactDeletionAction,
  type BackupActionState,
} from "@/lib/actions/backup-actions";
import ActionError from "./ActionError";

/**
 * Destroying a backup artifact — the most dangerous control in this app, and the
 * one that ships DISABLED. Read lib/backup-job-policy.ts for why: retention on
 * the box already deletes, declaratively and reviewably, and a button here turns
 * every other bug in this app into permanent customer data loss.
 *
 * Where it IS enabled, everything about it is friction on purpose:
 *
 *  • **Collapsed** behind a native `<details>`, so it is never one stray click
 *    away from an artifact you were only reading. `<details>` rather than a
 *    `useState` toggle because server actions here must work as plain form POSTs
 *    (CLAUDE.md §3) — a JS-driven toggle silently makes the control unreachable
 *    without hydration, which for a destructive control is the good failure, but
 *    it also makes the no-JS walk untestable.
 *  • **The slug is typed.** The artifact id travels in a hidden field; without
 *    typing, the difference between the right row and the wrong one is which
 *    line you happened to click.
 *  • **A reason is required** and lands verbatim in the audit log.
 *  • **The last copy needs an explicit override**, and the checkbox only appears
 *    when that is actually the situation, so it never becomes muscle memory.
 *
 * None of this is the guard. The server re-checks all four
 * (`backupDeleteVerdict`); this is what stops a mistake before it is made.
 */
export default function BackupDeleteForm({
  artifactId,
  tenantSlug,
  isLastCopy,
}: Readonly<{ artifactId: string; tenantSlug: string; isLastCopy: boolean }>) {
  const t = useTranslations("control.admin.backups.delete");
  const [state, action, pending] = useActionState<BackupActionState, FormData>(
    requestArtifactDeletionAction,
    {},
  );

  if (state.ok) {
    return (
      <p className="font-label text-sm text-craft-success-text dark:text-craft-success">
        {t("queued", { slug: state.queuedSlug ?? tenantSlug })}
      </p>
    );
  }

  // `open` is forced when the server refused: an error rendered inside a
  // collapsed section is an error nobody reads, and the refusals here are the
  // whole safety story.
  return (
    <details className="mt-2" open={Boolean(state.error)}>
      <summary className="cursor-pointer font-label text-sm underline">{t("reveal")}</summary>
      <form action={action} className="mt-2 grid gap-2">
        <p role="alert" className="font-label text-sm text-craft-error-text">
          {isLastCopy ? t("warningLastCopy", { slug: tenantSlug }) : t("warning")}
        </p>
        <input type="hidden" name="artifactId" value={artifactId} />
        <label className="grid gap-1 font-label text-sm">
          {t("confirmLabel", { slug: tenantSlug })}
          <input
            name="confirmSlug"
            required
            autoComplete="off"
            placeholder={tenantSlug}
            className="input-primary"
          />
        </label>
        <label className="grid gap-1 font-label text-sm">
          {t("reasonLabel")}
          <input name="reason" required minLength={8} autoComplete="off" className="input-primary" />
        </label>
        {isLastCopy && (
          <label className="flex items-center gap-2 font-label text-sm text-craft-error-text">
            <input type="checkbox" name="override" />
            {t("override")}
          </label>
        )}
        <button type="submit" className="btn-secondary text-sm" disabled={pending}>
          {pending ? t("pending") : t("confirm")}
        </button>
        <ActionError code={state.error} />
      </form>
    </details>
  );
}
