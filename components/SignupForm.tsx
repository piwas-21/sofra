"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Status = "idle" | "sending" | "success" | "error" | "invalidEmail" | "invalidSlug";

// Must mirror the registry grammar used by signupSchema (lib/validation.ts) so
// the client rejects a bad slug with a field-level message instead of letting
// the API bounce the whole submission with a generic error.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export default function SignupForm() {
  const t = useTranslations("signup.form");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email ?? ""))) {
      setStatus("invalidEmail");
      return;
    }
    const slug = String(data.desiredSlug ?? "").trim();
    if (slug && !SLUG_RE.test(slug)) {
      setStatus("invalidSlug");
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the trimmed slug so the value we validated is the value we submit
        // (no client/server divergence on stray whitespace).
        body: JSON.stringify({ ...data, desiredSlug: slug, locale }),
      });
      if (!res.ok) throw new Error(`signup api ${res.status}`);
      form.reset();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p
        role="status"
        className="hand-drawn-border bg-card px-6 py-5 font-hand text-2xl text-craft-olive-text dark:text-craft-olive-dark"
      >
        {t("success")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <input
        name="restaurantName"
        required
        autoComplete="organization"
        placeholder={t("restaurantName")}
        aria-label={t("restaurantName")}
        className="input-primary"
      />
      <input
        name="contactName"
        required
        autoComplete="name"
        placeholder={t("contactName")}
        aria-label={t("contactName")}
        className="input-primary"
      />
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder={t("email")}
        aria-label={t("email")}
        className="input-primary"
      />
      <input
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder={t("phone")}
        aria-label={t("phone")}
        className="input-primary"
      />
      <input
        name="city"
        autoComplete="address-level2"
        placeholder={t("city")}
        aria-label={t("city")}
        className="input-primary"
      />
      <div className="flex flex-col gap-1">
        <input
          name="desiredSlug"
          inputMode="url"
          placeholder={t("desiredSlug")}
          aria-label={t("desiredSlug")}
          aria-describedby="desiredSlug-hint"
          className="input-primary"
        />
        <span id="desiredSlug-hint" className="font-label text-xs text-muted-foreground">
          {t("desiredSlugHint")}
        </span>
      </div>
      <textarea
        name="message"
        rows={4}
        maxLength={2000}
        placeholder={t("message")}
        aria-label={t("message")}
        className="input-primary resize-y sm:col-span-2"
      />
      {/* Honeypot — hidden from humans, bots fill it and get politely ignored */}
      <input
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={status === "sending"} className="btn-primary disabled:opacity-60">
          {status === "sending" ? t("sending") : t("submit")}
        </button>
        {status === "invalidEmail" && (
          <p role="alert" className="font-label text-destructive">
            {t("invalidEmail")}
          </p>
        )}
        {status === "invalidSlug" && (
          <p role="alert" className="font-label text-destructive">
            {t("invalidSlug")}
          </p>
        )}
        {status === "error" && (
          <p role="alert" className="font-label text-destructive">
            {t("error")}
          </p>
        )}
      </div>
    </form>
  );
}
