"use client";

import { useActionState } from "react";
import { setPasswordAction, type FormState } from "@/lib/actions/auth-actions";
import { ErrorMessage } from "./StatusMessage";

export type SetPasswordLabels = {
  newPassword: string;
  repeatPassword: string;
  submit: string;
  saving: string;
};

export default function SetPasswordForm({
  token,
  purpose,
  labels,
}: {
  token: string;
  purpose: "invite" | "reset";
  labels: SetPasswordLabels;
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
        placeholder={labels.newPassword}
        aria-label={labels.newPassword}
        className="input-primary"
      />
      <input
        name="confirm"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        placeholder={labels.repeatPassword}
        aria-label={labels.repeatPassword}
        className="input-primary"
      />
      <div>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? labels.saving : labels.submit}
        </button>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
