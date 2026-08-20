"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  proposeClientDomainAction,
  type DomainProposalState,
} from "@/lib/actions/partner-domain-proposal-actions";
import ActionError from "./ActionError";
import ClientDomainOutcome from "./ClientDomainOutcome";

export interface ChooserBaseDomain {
  id: string;
  domain: string;
}

/**
 * "Where should this restaurant live?" — asked of the partner, BEFORE a tenant exists
 * (SOFRA-PARTNER-FLEXIBILITY-PLAN D2).
 *
 * Four options, and the fourth is deliberately not one: buying a domain through us is
 * fully designed (ADR-002 §3) and blocked on domainio#231 — a freshly registered domain
 * cannot receive DNS records through the API, so selling it today ends with a domain we
 * own and cannot point anywhere. It is rendered as an explicitly unavailable radio
 * rather than omitted, because a partner who has been promised it should be able to see
 * that we know about it, and the server refuses it independently anyway.
 *
 * Option 2 appears only when the partner has a VERIFIED base domain; with none it shows
 * the route to getting one instead of a dead control. The verification is re-checked
 * server-side regardless — this is a disclosure, not a gate.
 *
 * A plain `<form action={...}>` with named fields, so it works as an ordinary POST
 * without JavaScript. The per-option DNS instructions are NOT branched client-side for
 * the same reason: they are rendered from the server's own resolved answer after the
 * submit, which is the only version that survives a no-JS render — and the only one
 * that reflects what the action actually decided.
 */
export default function ClientDomainChooser({
  clientId,
  suggestedSlug,
  baseDomains,
  boxIp,
}: Readonly<{
  clientId: string;
  suggestedSlug: string;
  baseDomains: ChooserBaseDomain[];
  boxIp?: string;
}>) {
  const t = useTranslations("control.domainChoice");
  const [state, action, pending] = useActionState<DomainProposalState, FormData>(
    proposeClientDomainAction,
    {},
  );
  const hasBase = baseDomains.length > 0;

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="id" value={clientId} />

      <label className="grid gap-1 font-label text-sm text-muted-foreground sm:max-w-sm">
        {t("slugLabel")}
        <input
          name="slug"
          required
          pattern="[a-z0-9][a-z0-9\-]{1,30}"
          maxLength={31}
          defaultValue={suggestedSlug}
          autoComplete="off"
          spellCheck={false}
          className="input-primary font-mono"
        />
        <span className="text-xs">{t("slugHint")}</span>
      </label>

      <fieldset className="grid gap-3">
        <legend className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
          {t("optionsLegend")}
        </legend>

        <label className="flex gap-3 rounded-craft border-2 border-border p-3">
          <input type="radio" name="choice" value="sofra" defaultChecked className="mt-1" />
          <span>
            <span className="font-bold">{t("optionSofra")}</span>
            <span className="block font-label text-sm text-muted-foreground">
              {t("optionSofraHint")}
            </span>
          </span>
        </label>

        <label className="flex gap-3 rounded-craft border-2 border-border p-3">
          <input
            type="radio"
            name="choice"
            value="partnerBase"
            disabled={!hasBase}
            className="mt-1"
          />
          <span className="grid gap-2">
            <span className="font-bold">{t("optionPartnerBase")}</span>
            <span className="block font-label text-sm text-muted-foreground">
              {t("optionPartnerBaseHint")}
            </span>
            {hasBase ? (
              <select name="baseDomainId" className="input-primary font-mono sm:max-w-sm">
                {baseDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.domain}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-label text-sm">
                {t("noVerifiedBase")}{" "}
                <Link href="/dashboard/domains" className="underline">
                  {t("manageDomains")}
                </Link>
              </span>
            )}
          </span>
        </label>

        <label className="flex gap-3 rounded-craft border-2 border-border p-3">
          <input type="radio" name="choice" value="byo" className="mt-1" />
          <span className="grid gap-2">
            <span className="font-bold">{t("optionByo")}</span>
            <span className="block font-label text-sm text-muted-foreground">
              {t("optionByoHint")}
            </span>
            <input
              name="ownDomain"
              maxLength={253}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("ownDomainPlaceholder")}
              aria-label={t("ownDomainLabel")}
              className="input-primary font-mono sm:max-w-sm"
            />
          </span>
        </label>

        {/* Blocked on domainio#231, not merely unbuilt — see the component doc. */}
        <label className="flex gap-3 rounded-craft border-2 border-dashed border-border p-3 opacity-60">
          <input type="radio" name="choice" value="buy" disabled className="mt-1" />
          <span>
            <span className="font-bold">
              {t("optionBuy")} · {t("optionBuySoon")}
            </span>
            <span className="block font-label text-sm text-muted-foreground">
              {t("optionBuyHint")}
            </span>
          </span>
        </label>
      </fieldset>

      <label className="grid gap-1 font-label text-sm text-muted-foreground">
        {t("messageLabel")}
        <textarea
          name="message"
          rows={2}
          maxLength={2000}
          placeholder={t("messagePlaceholder")}
          className="input-primary resize-y"
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {pending ? t("sending") : t("submit")}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("sent")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>

      {state.proposal && <ClientDomainOutcome proposal={state.proposal} boxIp={boxIp} />}
    </form>
  );
}
