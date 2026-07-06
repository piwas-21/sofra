"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type FormState } from "@/lib/actions/auth-actions";
import { ErrorMessage, SuccessMessage } from "./StatusMessage";

export type ForgotLabels = {
  email: string;
  send: string;
  sending: string;
  sent: string;
};

export default function ForgotPasswordForm({ labels }: { labels: ForgotLabels }) {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});

  if (state.ok) {
    return <SuccessMessage>{labels.sent}</SuccessMessage>;
  }

  return (
    <form action={action} className="grid gap-4">
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder={labels.email}
        aria-label={labels.email}
        className="input-primary"
      />
      <div>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? labels.sending : labels.send}
        </button>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
