"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/actions/auth-actions";
import ActionError from "./ActionError";
import { SuccessMessage } from "./StatusMessage";

// One email field, one button, and the SAME sentence whatever the address turns
// out to be — the shape both self-service recovery forms need: "forgot my
// password" and "resend my invite" (G12).
//
// ONE component rather than two near-copies, and the reason is not tidiness. Both
// forms exist to be anti-enumeration surfaces, and the property lives in rendering
// the identical success message to everyone. Two components drift; the day one of
// them helpfully renders "no account found" is the day the pair becomes an oracle
// for which restaurants are customers.

export type EmailRequestLabels = {
  email: string;
  send: string;
  sending: string;
  sent: string;
};

export default function EmailRequestForm({
  action: serverAction,
  labels,
}: Readonly<{
  /** A server action with the shared `FormState` contract. Passed in from the
   *  page rather than imported here, which is what lets one component serve both
   *  flows without knowing either. */
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  labels: EmailRequestLabels;
}>) {
  const [state, action, pending] = useActionState<FormState, FormData>(serverAction, {});

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
