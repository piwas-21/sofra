"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  openProvisioningPrAction,
  type ProvisionActionState,
} from "@/lib/actions/provisioning-actions";
import ActionError from "./ActionError";
import ProvisionPicker from "./ProvisionPicker";
import ProvisionDomainField, { type ProvisionBaseDomainOption } from "./ProvisionDomainField";
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
  baseDomains = [],
}: Readonly<{
  disabled?: boolean;
  prefill?: ProvisionPrefill;
  /** Verified partner zones the founder may place this tenant under (D1). */
  baseDomains?: ProvisionBaseDomainOption[];
}>) {
  const t = useTranslations("control.admin");
  const [state, action, pending] = useActionState<ProvisionActionState, FormData>(
    openProvisioningPrAction,
    {},
  );
  // Held here rather than in the domain field, because the hostname preview is derived
  // from BOTH inputs and they sit in different halves of the form — the founder is
  // proposing an immutable identifier and should read the result before submitting.
  const [slug, setSlug] = useState(prefill?.slug ?? "");

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {/* Traceability only — the action does not read it today, but a proposal
          that cannot be tied back to its lead is a dead end for O3's automation. */}
      {prefill && <input type="hidden" name="signupId" value={prefill.signupId} />}
      <input
        name="slug"
        required
        pattern="[a-z0-9][a-z0-9\-]{1,30}"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
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
      {/* NOT an input any more (ADR-011 amendment). The premise this field rested on —
          "only the restaurant can create a connected account, and it cannot be
          pre-filled" — was measured false at CREATE time, so the control plane mints the
          account itself before this proposal is composed and the entry carries
          `online-payments` AND `stripe_account:` in one commit. Left as a read-only
          sentence rather than deleted: the founder is about to review a PR whose diff
          contains an `acct_` nobody typed, and this is where they learn where it came
          from. If the mint fails, the PR body says so and says what to do. */}
      <p className="sm:col-span-2 font-label text-sm text-muted-foreground">
        {t("provision.stripeAccountNote")}
      </p>
      {/* A partner's own zone (SOFRA-PARTNER-FLEXIBILITY-PLAN D1). The default option is
          empty and emits exactly the entry this form emitted before the field existed:
          `<slug>.sofrapiwas.com`, no `base_domain:` key. Picked, the entry's domain is
          derived as `<slug>.<base>` and the PR body gains the pre-flight check — the A
          record has to resolve BEFORE the merge, because certificates are issued per
          hostname over HTTP-01 and cannot be pre-issued. */}
      <ProvisionDomainField slug={slug} options={baseDomains} />
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
