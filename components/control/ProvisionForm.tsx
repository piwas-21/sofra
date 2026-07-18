"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  openProvisioningPrAction,
  type ProvisionActionState,
} from "@/lib/actions/provisioning-actions";
import ActionError from "./ActionError";

/**
 * Admin form that proposes a new tenant (ADR-012): submits to the server action
 * which opens a registry PR on the deploy repo and returns its URL. Slug-derived
 * fields (db/domain/compose_project) are computed server-side, not entered.
 */
export default function ProvisionForm({ disabled }: Readonly<{ disabled?: boolean }>) {
  const t = useTranslations("control.admin");
  const [state, action, pending] = useActionState<ProvisionActionState, FormData>(
    openProvisioningPrAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input
        name="slug"
        required
        pattern="[a-z0-9][a-z0-9-]{1,30}"
        placeholder={t("provision.slug")}
        aria-label={t("provision.slug")}
        className="input-primary"
      />
      <input
        name="name"
        required
        maxLength={200}
        placeholder={t("provision.name")}
        aria-label={t("provision.name")}
        className="input-primary"
      />
      <input
        name="adminEmail"
        type="email"
        required
        maxLength={200}
        placeholder={t("provision.adminEmail")}
        aria-label={t("provision.adminEmail")}
        className="input-primary"
      />
      <input
        name="city"
        maxLength={200}
        placeholder={t("provision.city")}
        aria-label={t("provision.city")}
        className="input-primary"
      />
      <label className="grid gap-1 font-label text-sm text-muted-foreground">
        {t("provision.template")}
        <select
          name="template"
          defaultValue="craft"
          aria-label={t("provision.template")}
          className="input-primary"
        >
          <option value="craft">craft</option>
          <option value="classic">classic</option>
        </select>
      </label>
      <input
        name="currency"
        required
        pattern="[A-Z]{3}"
        defaultValue="EUR"
        placeholder={t("provision.currency")}
        aria-label={t("provision.currency")}
        className="input-primary"
      />
      <input
        name="languages"
        required
        defaultValue="en, nl"
        placeholder={t("provision.languages")}
        aria-label={t("provision.languages")}
        className="input-primary"
      />
      <input
        name="modules"
        required
        defaultValue="core"
        placeholder={t("provision.modules")}
        aria-label={t("provision.modules")}
        className="input-primary"
      />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending || disabled} className="btn-primary disabled:opacity-60">
          {pending ? t("provision.creating") : t("provision.create")}
        </button>
        <ActionError code={state.error} />
      </div>
      {state.ok && state.prUrl && (
        <div className="sm:col-span-2 grid gap-2">
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("provision.created")}
          </span>
          <a
            href={state.prUrl}
            target="_blank"
            rel="noreferrer"
            className="font-label text-sm underline break-all"
          >
            {state.prUrl}
          </a>
          <span className="font-label text-sm text-muted-foreground">{t("provision.nextSteps")}</span>
        </div>
      )}
    </form>
  );
}
