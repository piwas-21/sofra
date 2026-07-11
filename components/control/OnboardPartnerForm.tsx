"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { onboardPartnerAction, type OnboardActionState } from "@/lib/actions/onboarding-actions";
import ActionError from "./ActionError";
import CopyField from "./CopyField";

export default function OnboardPartnerForm() {
  const t = useTranslations("control.admin");
  const [state, action, pending] = useActionState<OnboardActionState, FormData>(
    onboardPartnerAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input
        name="name"
        required
        maxLength={200}
        placeholder={t("onboard.name")}
        aria-label={t("onboard.name")}
        className="input-primary"
      />
      <input
        name="email"
        type="email"
        required
        maxLength={200}
        placeholder={t("onboard.email")}
        aria-label={t("onboard.email")}
        className="input-primary"
      />
      <input
        name="tenantSlug"
        required
        pattern="[a-z0-9][a-z0-9-]{1,30}"
        placeholder={t("onboard.slug")}
        aria-label={t("onboard.slug")}
        className="input-primary"
      />
      <input
        name="restaurantName"
        required
        maxLength={200}
        placeholder={t("onboard.restaurantName")}
        aria-label={t("onboard.restaurantName")}
        className="input-primary"
      />
      <input
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        required
        placeholder={t("onboard.amount")}
        aria-label={t("onboard.amount")}
        className="input-primary"
      />
      <select
        name="interval"
        aria-label={t("onboard.interval")}
        className="input-primary"
        defaultValue="month"
      >
        <option value="month">{t("intervals.month")}</option>
        <option value="quarter">{t("intervals.quarter")}</option>
        <option value="year">{t("intervals.year")}</option>
      </select>
      <label className="sm:col-span-2 grid gap-1 font-label text-sm text-muted-foreground">
        {t("onboard.liveSince")}
        <input name="liveSince" type="date" aria-label={t("onboard.liveSince")} className="input-primary" />
      </label>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? t("onboard.creating") : t("onboard.create")}
        </button>
        <ActionError code={state.error} />
      </div>
      {state.ok && (
        <div className="sm:col-span-2 grid gap-2">
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("onboard.created")}
          </span>
          {state.inviteLink && <CopyField value={state.inviteLink} />}
          <span className="font-label text-sm text-muted-foreground">{t("onboard.inviteNote")}</span>
        </div>
      )}
    </form>
  );
}
