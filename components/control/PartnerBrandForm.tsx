"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  savePartnerBrandAction,
  type PartnerBrandState,
} from "@/lib/actions/partner-brand-actions";
import { isLegalNameEcho } from "@/lib/partner-brand";
import ActionError from "./ActionError";

/** What the page hands in — either the stored row or, for a partner who has none
 *  yet, a prefill carrying nothing but a display name. */
export type BrandDefaults = {
  displayName: string;
  tagline?: string | null;
  websiteUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  publishToTenants?: boolean;
};

type TextField = Exclude<keyof BrandDefaults, "publishToTenants">;

/**
 * A partner's PUBLIC details (SOFRA-PARTNER-PLAN §11).
 *
 * Bound directly to the server action so it also works as a plain form POST with
 * no JavaScript (CLAUDE.md §3).
 *
 * Everything here is typed by hand, including the address, and that is the
 * design rather than an oversight: the control plane already holds an address for
 * this partner, in `BillingIdentity`, and for a sole trader it is their home.
 * Only `displayName` may be prefilled, from the TRADE name (lib/partner-brand.ts).
 */
export default function PartnerBrandForm({
  defaults,
  legalName,
  hasTradeName,
}: Readonly<{ defaults?: BrandDefaults; legalName?: string | null; hasTradeName?: boolean }>) {
  const t = useTranslations("control.brand");
  const [state, action, pending] = useActionState<PartnerBrandState, FormData>(
    savePartnerBrandAction,
    {},
  );

  // Watched, so the partner is told before saving when the value is the legal name.
  // The same server-side projection refuses it at apply time (D-B1a).
  const [displayName, setDisplayName] = useState(defaults?.displayName ?? "");
  const echoesLegalName = isLegalNameEcho(displayName, legalName);

  const field = (
    name: TextField,
    opts: { required?: boolean; type?: string; maxLength?: number } = {},
  ) => (
    <label key={name} className="grid gap-1 font-label text-sm text-muted-foreground">
      {t(`fields.${name}`)}
      <input
        name={name}
        type={opts.type ?? "text"}
        required={opts.required}
        maxLength={opts.maxLength ?? 200}
        defaultValue={defaults?.[name] ?? ""}
        onChange={name === "displayName" ? (e) => setDisplayName(e.target.value) : undefined}
        className="input-primary"
      />
    </label>
  );

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {/* Said once, up front, to the partner it applies to: a sole trader whose
          billing record has no trade name has nothing we could publish, because the
          only other name we hold is their own (§11b). Better here, where they are
          about to type, than as a refusal after they save. */}
      {legalName && !hasTradeName && (
        <p className="sm:col-span-2 font-label text-sm text-muted-foreground">
          {t("noTradeNameNote")}
        </p>
      )}
      {field("displayName", { required: true, maxLength: 80 })}
      {/* `<output>` rather than `role="status"`: same live region, and the native
          element is announced by assistive tech that does not implement the ARIA
          role (S6819). It is a live region on purpose — the partner types and the
          verdict changes under them, so it has to be spoken, not merely rendered. */}
      {echoesLegalName && (
        <output className="sm:col-span-2 font-label text-sm text-craft-error-text">
          {t("legalNameNotPublished")}
        </output>
      )}
      {field("tagline", { maxLength: 120 })}
      {field("websiteUrl", { type: "url", maxLength: 200 })}
      {field("email", { type: "email" })}
      {field("phone", { maxLength: 40 })}
      {field("addressLine1")}
      {field("postalCode", { maxLength: 20 })}
      {field("city", { maxLength: 120 })}
      {field("countryCode", { maxLength: 2 })}

      {/* This is explicit opt-in for future guest-facing attribution. Existing
          sites still require the separate reviewable apply action below. */}
      <fieldset className="sm:col-span-2 hand-drawn-border bg-card p-4 grid gap-2">
        <label className="flex items-start gap-3 font-label">
          <input
            type="checkbox"
            name="publishToTenants"
            defaultChecked={defaults?.publishToTenants ?? false}
            className="mt-1"
          />
          <span>{t("publishLabel")}</span>
        </label>
        <p className="font-label text-sm text-muted-foreground">{t("publishMeaning")}</p>
      </fieldset>

      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? t("saving") : t("save")}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("savedApply")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
