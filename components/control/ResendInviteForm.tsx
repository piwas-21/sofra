"use client";

import { useActionState } from "react";
import { resendInviteAction, type FormState } from "@/lib/actions/auth-actions";
import ActionError from "./ActionError";
import { SuccessMessage } from "./StatusMessage";

// "Send me that invite again" (G12). Deliberately the same shape as
// ForgotPasswordForm: one field, one button, and the SAME success sentence
// whatever the address turns out to be — the anti-enumeration property lives in
// the action, and a form that rendered a different message for a known address
// would give it straight back.

export type ResendInviteLabels = {
  email: string;
  send: string;
  sending: string;
  sent: string;
};

export default function ResendInviteForm({ labels }: { labels: ResendInviteLabels }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resendInviteAction, {});

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
      <ActionError code={state.error} namespace="auth.errors" />
    </form>
  );
}
