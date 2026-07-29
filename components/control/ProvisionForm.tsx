"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  openProvisioningPrAction,
  type ProvisionActionState,
} from "@/lib/actions/provisioning-actions";
import ActionError from "./ActionError";
import ProvisionPicker from "./ProvisionPicker";
import type { ProvisionPrefill } from "@/lib/provision-prefill";

/**
 * Admin form that proposes a new tenant (ADR-012): submits to the server action
 * which opens a registry PR on the deploy repo and returns its URL. Slug-derived
 * fields (db/domain/compose_project) are computed server-side, not entered.
 *
 * `prefill` carries a signup lead's own answers (SOFRA-ONBOARDING-PLAN O1). The
 * founder edits them; nothing is submitted that they did not see.
 */
export default function ProvisionForm({
  disabled,
  prefill,
}: Readonly<{ disabled?: boolean; prefill?: ProvisionPrefill }>) {
  const t = useTranslations("control.admin");
  const [state, action, pending] = useActionState<ProvisionActionState, FormData>(
    openProvisioningPrAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {/* Traceability only — the action does not read it today, but a proposal
          that cannot be tied back to its lead is a dead end for O3's automation. */}
      {prefill && <input type="hidden" name="signupId" value={prefill.signupId} />}
      <input
        name="slug"
        required
        pattern="[a-z0-9][a-z0-9\-]{1,30}"
        defaultValue={prefill?.slug}
        placeholder={t("provision.slug")}
        aria-label={t("provision.slug")}
        className="input-primary"
      />
      <input
        name="name"
        required
        maxLength={200}
        defaultValue={prefill?.name}
        placeholder={t("provision.name")}
        aria-label={t("provision.name")}
        className="input-primary"
      />
      <input
        name="adminEmail"
        type="email"
        required
        maxLength={200}
        defaultValue={prefill?.adminEmail}
        placeholder={t("provision.adminEmail")}
        aria-label={t("provision.adminEmail")}
        className="input-primary"
      />
      <input
        name="city"
        maxLength={200}
        defaultValue={prefill?.city}
        placeholder={t("provision.city")}
        aria-label={t("provision.city")}
        className="input-primary"
      />
      <label className="grid gap-1 font-label text-sm text-muted-foreground">
        {t("provision.template")}
        <select
          name="template"
          // A lead who chose no template leaves the founder's default standing.
          defaultValue={prefill?.template ?? "craft"}
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
        defaultValue={prefill?.currency ?? "EUR"}
        placeholder={t("provision.currency")}
        aria-label={t("provision.currency")}
        className="input-primary"
      />
      <ProvisionPicker
        initialModules={prefill?.modules}
        initialLanguages={prefill?.languages}
        labels={{
          modules: t("provision.modules"),
          modulesCore: t("provision.modulesCore"),
          languages: t("provision.languages"),
          languagesHint: t("provision.languagesHint"),
          price: t("provision.price"),
          priceBundle: t("provision.priceBundle"),
          priceALaCarte: t("provision.priceALaCarte"),
        }}
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
