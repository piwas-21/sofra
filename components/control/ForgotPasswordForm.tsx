"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type FormState } from "@/lib/actions/auth-actions";
import { ErrorMessage, SuccessMessage } from "./StatusMessage";

export default function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});

  if (state.ok) {
    return (
      <SuccessMessage>
        If that address has a partner account, a reset link is on its way.
      </SuccessMessage>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        aria-label="Email"
        className="input-primary"
      />
      <div>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
