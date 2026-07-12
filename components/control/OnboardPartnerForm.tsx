"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { onboardPartnerAction, type OnboardActionState } from "@/lib/actions/onboarding-actions";
import { type OnboardTenant, isOnboardable } from "@/lib/onboard-tenants";
import ActionError from "./ActionError";
import CopyField from "./CopyField";

/**
 * Admin onboarding form. When the page can read the tenant registry it passes
 * `tenants` and the form drives the tenant from a registry picker (partner-free
 * by default, pre-filling restaurant name + go-live date). When the registry is
 * unavailable `tenants` is undefined and it falls back to free-text inputs — the
 * server action + slug regex are identical in both modes.
 */
export default function OnboardPartnerForm({ tenants }: { tenants?: OnboardTenant[] }) {
  const t = useTranslations("control.admin");
  const [state, action, pending] = useActionState<OnboardActionState, FormData>(
    onboardPartnerAction,
    {},
  );

  // Registry-driven picker state. `slug` also keys the pre-filled restaurant
  // name + date inputs so selecting a tenant remounts them with fresh defaults
  // while leaving them editable.
  const [slug, setSlug] = useState("");
  const [showAll, setShowAll] = useState(false);
  const registryMode = Array.isArray(tenants);
  const selectable = tenants?.filter(isOnboardable) ?? [];
  const visible = showAll ? (tenants ?? []) : selectable;
  const selected = tenants?.find((tn) => tn.slug === slug);

  const optionLabel = (tn: OnboardTenant) => {
    const badge = tn.onboarded
      ? ` (${t("onboard.onboardedBadge")})`
      : tn.status !== "active"
        ? ` (${tn.status})`
        : "";
    return `${tn.slug} — ${tn.name}${tn.city ? ` · ${tn.city}` : ""}${badge}`;
  };

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

      {registryMode ? (
        <>
          <label className="sm:col-span-2 grid gap-1 font-label text-sm text-muted-foreground">
            {t("onboard.tenant")}
            <select
              name="tenantSlug"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              aria-label={t("onboard.tenant")}
              className="input-primary"
            >
              <option value="" disabled>
                {t("onboard.tenantPlaceholder")}
              </option>
              {visible.map((tn) => (
                <option key={tn.slug} value={tn.slug} disabled={!isOnboardable(tn)}>
                  {optionLabel(tn)}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2 flex items-center gap-2 font-label text-sm text-muted-foreground">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {t("onboard.showAll")}
          </label>
          {selectable.length === 0 && !showAll && (
            <p className="sm:col-span-2 font-label text-sm text-craft-error-text">
              {t("onboard.noTenants")}
            </p>
          )}
          {selected && (
            <p className="sm:col-span-2 font-label text-sm text-muted-foreground">
              {[selected.city, selected.currency ?? "EUR"].filter(Boolean).join(" · ")}
              {selected.liveSince ? ` · ${t("onboard.liveSincePrefix")} ${selected.liveSince}` : ""}
            </p>
          )}
          <input
            key={slug || "none"}
            name="restaurantName"
            required
            maxLength={200}
            defaultValue={selected?.name ?? ""}
            placeholder={t("onboard.restaurantName")}
            aria-label={t("onboard.restaurantName")}
            className="input-primary sm:col-span-2"
          />
        </>
      ) : (
        <>
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
        </>
      )}

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
        <input
          key={`ls-${slug || "none"}`}
          name="liveSince"
          type="date"
          defaultValue={registryMode ? (selected?.liveSince ?? "") : undefined}
          aria-label={t("onboard.liveSince")}
          className="input-primary"
        />
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
