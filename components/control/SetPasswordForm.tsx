"use client";

import { useActionState } from "react";
import { setPasswordAction, type FormState } from "@/lib/actions/auth-actions";
import { ErrorMessage } from "./StatusMessage";

export default function SetPasswordForm({
  token,
  purpose,
}: {
  token: string;
  purpose: "invite" | "reset";
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordAction, {});

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="purpose" value={purpose} />
      <input
        name="password"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        placeholder="New password (min. 10 characters)"
        aria-label="New password"
        className="input-primary"
      />
      <input
        name="confirm"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        placeholder="Repeat password"
        aria-label="Repeat password"
        className="input-primary"
      />
      <div>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Saving…" : "Set password"}
        </button>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
