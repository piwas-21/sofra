"use client";

import { useTranslations } from "next-intl";
import { useIntakeForm, looksLikeEmail } from "@/hooks/useIntakeForm";

export default function PartnerForm() {
  const t = useTranslations("partner.form");
  const { status, submit } = useIntakeForm("/api/partner/apply", (data) =>
    looksLikeEmail(data.email) ? null : "invalid",
  );

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
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
        name="company"
        placeholder={t("company")}
        aria-label={t("company")}
        className="input-primary"
      />
      <input
        name="city"
        placeholder={t("city")}
        aria-label={t("city")}
        className="input-primary"
      />
      <textarea
        name="message"
        required
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
        {status === "invalid" && (
          <p role="alert" className="font-label text-destructive">
            {t("invalidEmail")}
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
