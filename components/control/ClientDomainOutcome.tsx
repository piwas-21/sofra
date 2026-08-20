"use client";

import { useTranslations } from "next-intl";
import type { DomainProposal } from "@/lib/client-domain-choice";
import CopyField from "./CopyField";

/**
 * What was proposed, and what now has to exist in DNS before it can be provisioned.
 *
 * Rendered from the SERVER'S answer, not from what the form thought it was sending —
 * the choice is re-resolved in the action (the base domain is re-read scoped by partner
 * and re-checked for a proof), so this is the only honest place to print the hostname.
 * It also means the instruction survives a no-JS submit, where nothing client-side
 * knows which radio was picked.
 *
 * `boxIp` is env (`TENANT_BOX_IP`) and may be unset. Unset prints "we will send you the
 * address" rather than a plausible-looking placeholder: an A record pointing at the
 * wrong IP fails in a way that looks like our fault and takes a day to find.
 */
export default function ClientDomainOutcome({
  proposal,
  boxIp,
}: Readonly<{ proposal: DomainProposal; boxIp?: string }>) {
  const t = useTranslations("control.domainChoice");

  return (
    <div className="hand-drawn-border bg-muted/40 p-5 grid gap-3">
      <p className="font-hand text-2xl font-bold">{t("outcomeTitle")}</p>
      <p className="font-mono text-sm break-all">{proposal.domain}</p>

      {proposal.requiredRecord ? (
        <div className="grid gap-2">
          <p className="font-label text-sm text-muted-foreground">
            {t(proposal.publishedBy === "partner" ? "outcomeWhoPartner" : "outcomeWhoRestaurant")}
          </p>
          <dl className="grid gap-2">
            <div className="grid gap-1">
              <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {t("recordType")}
              </dt>
              <dd className="font-mono text-sm">{proposal.requiredRecord.type}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {t("recordName")}
              </dt>
              <dd>
                <CopyField value={proposal.requiredRecord.name} label={t("recordName")} />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {t("recordValue")}
              </dt>
              <dd>
                {boxIp ? (
                  <CopyField value={boxIp} label={t("recordValue")} />
                ) : (
                  <span className="font-label text-sm text-muted-foreground">
                    {t("recordValueUnknown")}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {/* The trap this exists for: certificates are issued per hostname over
              HTTP-01, so the name must already answer. Provisioned first, the tenant
              stands up without TLS and looks like a broken product. */}
          <p className="font-label text-sm text-craft-error-text">{t("outcomeBeforeProvisioning")}</p>
        </div>
      ) : (
        <p className="font-label text-sm text-muted-foreground">{t("outcomeNoDns")}</p>
      )}

      <p className="font-label text-xs text-muted-foreground">{t("footerNote")}</p>
    </div>
  );
}
