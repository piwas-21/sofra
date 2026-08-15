"use client";

import { useTranslations } from "next-intl";
import { useIntakeForm, looksLikeEmail } from "@/hooks/useIntakeForm";
import { checkSlug } from "@/lib/slug-availability";
import { interpretSignupResponse } from "@/lib/signup-outcome";
import SignupConfigurator from "./SignupConfigurator";

// Checkbox groups — collected with getAll and joined, never Object.fromEntries,
// which would keep only the last ticked box. See useIntakeForm.
const MULTI_VALUE_FIELDS = ["modules", "languages"] as const;

// The three outcomes that end the form rather than asking for a correction.
// `successAccountNoEmail` is the honest one: the account exists, so this is not
// an error the customer can act on by resubmitting — resubmitting would only be
// refused, their email already having a plan for that address.
const OUTCOME_MESSAGES = {
  success: "successAccount",
  successNoEmail: "successAccountNoEmail",
  successLead: "success",
} as const;

export default function SignupForm() {
  const t = useTranslations("signup.form");
  const { status, submit } = useIntakeForm(
    "/api/signup",
    (data) => {
      if (!looksLikeEmail(data.email)) return "invalidEmail";
      // The slug is checked against the shared grammar AND the reserved list here,
      // where the customer is still at the keyboard. It is the most expensive
      // field in the funnel to get wrong: it becomes the subdomain, database, DB
      // role and compose project, none of which can be renamed later — and since
      // O2 it is also the billing anchor of the plan created on submit.
      //
      // No taken-check on the client: that needs the registry, and shipping the
      // tenant list to every visitor to save one round-trip is a bad trade. The
      // route answers 409 `slugTaken`, which lands in `interpretResponse` below.
      const slug = data.desiredSlug.trim();
      const verdict = checkSlug(slug);
      if (verdict === "invalid") return "invalidSlug";
      if (verdict === "reserved") return "slugReserved";
      // Send the trimmed slug we validated (no client/server whitespace divergence).
      data.desiredSlug = slug;
      return null;
    },
    MULTI_VALUE_FIELDS,
    // Five outcomes, four of them not "error": the account was created and the
    // welcome email is out, the account was created but the email FAILED, the
    // lead was captured for the founder, or the address needs changing. Decided
    // in lib/signup-outcome so the branch nobody can see is unit-testable.
    (res, body) => interpretSignupResponse(res.status, body, res.ok),
  );

  const outcomeMessage = OUTCOME_MESSAGES[status as keyof typeof OUTCOME_MESSAGES];

  if (outcomeMessage) {
    return (
      <output className="block hand-drawn-border bg-card px-6 py-5 font-hand text-2xl text-craft-olive-text dark:text-craft-olive-dark">
        {t(outcomeMessage)}
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
        {/* Required since O2: the slug is the plan's billing anchor, so a signup
            without one cannot create an account. `pattern` is escaped as
            `[a-z0-9\-]` — a trailing `-` inside the class is invalid under
            Chrome's `v`-mode parser, which DISCARDS the whole attribute and
            leaves the field with no validation at all (see #92). */}
        <input
          name="desiredSlug"
          required
          inputMode="url"
          pattern="[a-z0-9][a-z0-9\-]{1,30}"
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
        {(status === "invalidEmail" ||
          status === "invalidSlug" ||
          status === "slugReserved" ||
          status === "slugTaken" ||
          status === "error") && (
          <p role="alert" className="font-label text-destructive">
            {t(status)}
          </p>
        )}
      </div>
    </form>
  );
}
