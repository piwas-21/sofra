"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addNoteAction, type PartnerActionState } from "@/lib/actions/partner-actions";
import ActionError from "./ActionError";

/**
 * Bound directly to the server action so the form also works without JS
 * (progressive enhancement). The parent keys this component by the note
 * count, so a successful add re-mounts it with an empty textarea.
 */
export default function NoteForm({ clientId }: { clientId: string }) {
  const t = useTranslations("control.noteForm");
  const [state, action, pending] = useActionState<PartnerActionState, FormData>(addNoteAction, {});

  return (
    <form action={action} className="grid gap-3">
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
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {pending ? t("saving") : t("add")}
        </button>
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
