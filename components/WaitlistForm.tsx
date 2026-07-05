"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

const CONTACT_EMAIL = "mahmutkaya.nl@gmail.com"; // founder inbox (owner-approved); move to a sofra-domain alias later

const INTENTS = ["waitlist", "demo", "call", "quote"] as const;
type Intent = (typeof INTENTS)[number];

type Status = "idle" | "sending" | "success" | "error" | "invalid";

export default function WaitlistForm() {
  const t = useTranslations("waitlist.form");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("idle");
  const [intent, setIntent] = useState<Intent>("waitlist");

  // ShowcaseSection's demo/call/quote buttons preselect the request type
  // (see IntentLink) — the anchor scroll and the select update together.
  useEffect(() => {
    function onIntent(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (INTENTS.includes(detail)) setIntent(detail);
    }
    window.addEventListener("sofra:intent", onIntent);
    return () => window.removeEventListener("sofra:intent", onIntent);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email ?? ""))) {
      setStatus("invalid");
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, locale }),
      });
      if (!res.ok) throw new Error(`waitlist api ${res.status}`);
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
        {intent === "waitlist" ? t("success") : t("successRequest")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <input
        name="name"
        required
        autoComplete="name"
        placeholder={t("name")}
        aria-label={t("name")}
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
        name="restaurant"
        required
        placeholder={t("restaurant")}
        aria-label={t("restaurant")}
        className="input-primary"
      />
      <input
        name="city"
        placeholder={t("city")}
        aria-label={t("city")}
        className="input-primary"
      />
      <select
        name="intent"
        value={intent}
        onChange={(e) => setIntent(e.target.value as Intent)}
        aria-label={t("intentLabel")}
        className="input-primary sm:col-span-2"
      >
        {INTENTS.map((i) => (
          <option key={i} value={i}>
            {t(`intents.${i}`)}
          </option>
        ))}
      </select>
      {/* Honeypot — hidden from humans, bots fill it and get politely ignored */}
      <input
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={status === "sending"} className="btn-primary disabled:opacity-60">
          {status === "sending" ? t("sending") : t(`intents.${intent}`)}
        </button>

        {status === "invalid" && (
          <p role="alert" className="font-label text-destructive">
            {t("invalidEmail")}
          </p>
        )}
        {status === "error" && (
          <p role="alert" className="font-label text-destructive">
            {t("error")}{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
        )}
      </div>
    </form>
  );
}
