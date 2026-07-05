"use client";

import { useActionState } from "react";
import { addNoteAction, type PartnerActionState } from "@/lib/actions/partner-actions";
import { ErrorMessage } from "./StatusMessage";

/**
 * Bound directly to the server action so the form also works without JS
 * (progressive enhancement). The parent keys this component by the note
 * count, so a successful add re-mounts it with an empty textarea.
 */
export default function NoteForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState<PartnerActionState, FormData>(addNoteAction, {});

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={clientId} />
      <textarea
        name="body"
        required
        rows={3}
        maxLength={2000}
        placeholder="Add a note — call outcome, next step, who to ask for…"
        aria-label="New note"
        className="input-primary resize-y"
      />
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {pending ? "Saving…" : "Add note"}
        </button>
        <ErrorMessage>{state.error}</ErrorMessage>
      </div>
    </form>
  );
}
