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

  // Watched, so the partner is told BEFORE they save rather than after — and the
  // same predicate the publish choke point uses (lib/partner-brand.ts), so the UI
  // cannot promise something `renderableBrand` would then refuse. Saving is still
  // allowed: it is their record, and refusing the write would leave them with no way
  // to record their own name. What is refused is PUBLISHING it, and the note says so
  // rather than the form accepting it silently and dropping it later (D-B1a).
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

      {/* DISABLED on purpose, and the note says why. Nothing consumes
          `publishToTenants` yet (§11e is an open owner decision), and a switch
          that a partner can flip while nothing changes is a lie told to the one
          person entitled to decide this. The column, the action and
          `renderableBrand()` are all here, so enabling it later is this one
          attribute. A disabled checkbox is not submitted, which the action already
          reads as false. */}
      <fieldset className="sm:col-span-2 hand-drawn-border bg-card p-4 grid gap-2">
        <label className="flex items-start gap-3 font-label">
          <input
            type="checkbox"
            name="publishToTenants"
            disabled
            defaultChecked={defaults?.publishToTenants ?? false}
            className="mt-1"
          />
          <span>{t("publishLabel")}</span>
        </label>
        <p className="font-label text-sm text-muted-foreground">{t("publishMeaning")}</p>
        <p className="font-label text-sm text-craft-error-text">{t("publishUnavailable")}</p>
      </fieldset>

      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? t("saving") : t("save")}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("saved")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
