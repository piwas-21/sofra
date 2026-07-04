"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

const CONTACT_EMAIL = "mahmutkaya.nl@gmail.com"; // founder inbox (owner-approved); move to a sofra-domain alias later

type Status = "idle" | "sending" | "success" | "error" | "invalid";

export default function WaitlistForm() {
  const t = useTranslations("waitlist.form");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("idle");

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
        {t("success")}
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
          {status === "sending" ? t("sending") : t("submit")}
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
