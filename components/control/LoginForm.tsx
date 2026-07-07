"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type FormState } from "@/lib/actions/auth-actions";
import { ErrorMessage } from "./StatusMessage";

// Labels come translated from the server page (control plane follows the
// marketing site's language via the NEXT_LOCALE cookie — lib/control-locale).
// Action error strings are still en-only: full control-plane i18n is tracked
// as a follow-up issue.
export type LoginLabels = {
  email: string;
  password: string;
  signIn: string;
  signingIn: string;
  forgot: string;
};

export default function LoginForm({ labels }: { labels: LoginLabels }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});

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
      <input
        name="password"
        type="password"
        required
        autoComplete="current-password"
        placeholder={labels.password}
        aria-label={labels.password}
        className="input-primary"
      />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? labels.signingIn : labels.signIn}
        </button>
        <Link href="/forgot" className="font-label text-sm underline text-muted-foreground">
          {labels.forgot}
        </Link>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
