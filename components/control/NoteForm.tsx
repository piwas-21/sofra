"use client";

import { useRef } from "react";
import { useActionState } from "react";
import { addNoteAction, type PartnerActionState } from "@/lib/actions/partner-actions";
import { ErrorMessage } from "./StatusMessage";

export default function NoteForm({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<PartnerActionState, FormData>(
    async (prev: PartnerActionState, fd: FormData) => {
      const result = await addNoteAction(prev, fd);
      if (result.ok) ref.current?.reset();
      return result;
    },
    {},
  );

  return (
    <form ref={ref} action={action} className="grid gap-3">
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
