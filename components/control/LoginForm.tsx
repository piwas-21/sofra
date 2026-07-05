"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/lib/actions/auth-actions";
import { ErrorMessage } from "./StatusMessage";

export default function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});

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
      <input
        name="password"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        className="input-primary"
      />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <a href="/forgot" className="font-label text-sm underline text-muted-foreground">
          Forgot password?
        </a>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
