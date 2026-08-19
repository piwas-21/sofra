"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  requestClientChangeAction,
  type ChangeRequestState,
} from "@/lib/actions/partner-change-actions";
import ActionError from "./ActionError";

/**
 * "Ask us for a change" — the partner's one action on a tenant SofraPiwas now manages.
 *
 * Bound directly to the server action so it also works without JS (progressive
 * enhancement, CLAUDE.md §3) — without it, the plain POST re-renders the page and the
 * textarea comes back empty on its own.
 *
 * Cleared by `form.reset()` rather than by the note-count `key` its sibling `NoteForm`
 * uses. Re-mounting is the cheaper trick, but it throws away `state.ok` in the same
 * tick the request succeeds — so the acknowledgement never renders, and the partner is
 * left looking at a form that emptied itself with no word about where their request
 * went. Keeping the component mounted keeps the answer.
 */
export default function ClientChangeRequestForm({ clientId }: Readonly<{ clientId: string }>) {
  const t = useTranslations("control.changeRequest");
  const [state, action, pending] = useActionState<ChangeRequestState, FormData>(
    requestClientChangeAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="grid gap-3">
      <input type="hidden" name="id" value={clientId} />
      <textarea
        name="body"
        required
        rows={3}
        maxLength={2000}
        placeholder={t("placeholder")}
        aria-label={t("aria")}
        className="input-primary resize-y"
      />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {pending ? t("sending") : t("submit")}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("sent")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
