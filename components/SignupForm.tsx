"use client";

import { useTranslations } from "next-intl";
import { useIntakeForm, looksLikeEmail } from "@/hooks/useIntakeForm";
import { checkSlug } from "@/lib/slug-availability";
import SignupConfigurator from "./SignupConfigurator";

// Checkbox groups — collected with getAll and joined, never Object.fromEntries,
// which would keep only the last ticked box. See useIntakeForm.
const MULTI_VALUE_FIELDS = ["modules", "languages"] as const;

export default function SignupForm() {
  const t = useTranslations("signup.form");
  const { status, submit } = useIntakeForm(
    "/api/signup",
    (data) => {
      if (!looksLikeEmail(data.email)) return "invalidEmail";
      // The slug is optional, so an empty one is fine — but a supplied one is
      // checked against the shared grammar AND the reserved list here, where the
      // customer is still at the keyboard. It is the most expensive field in the
      // funnel to get wrong: it becomes the subdomain, database, DB role and
      // compose project, none of which can be renamed later.
      //
      // No taken-check on the client: that needs the registry, and shipping the
      // tenant list to every visitor to save one round-trip is a bad trade. A
      // taken slug is caught server-side at /admin/provision, before anything
      // immutable exists.
      const slug = data.desiredSlug.trim();
      if (slug) {
        const verdict = checkSlug(slug);
        if (verdict === "invalid") return "invalidSlug";
        if (verdict === "reserved") return "slugReserved";
      }
      // Send the trimmed slug we validated (no client/server whitespace divergence).
      data.desiredSlug = slug;
      return null;
    },
    MULTI_VALUE_FIELDS,
  );

  if (status === "success") {
    return (
      <output className="block hand-drawn-border bg-card px-6 py-5 font-hand text-2xl text-craft-olive-text dark:text-craft-olive-dark">
        {t("success")}
      </output>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
      <SignupConfigurator />
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
        {(status === "invalidEmail" || status === "invalidSlug" ||
          status === "slugReserved" ||
          status === "error") && (
          <p role="alert" className="font-label text-destructive">
            {t(status)}
          </p>
        )}
      </div>
    </form>
  );
}
