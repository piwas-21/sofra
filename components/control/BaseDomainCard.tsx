import { getTranslations } from "next-intl/server";
import { shortDate } from "@/lib/format";
import {
  expectedTxtValue,
  verificationAge,
  verifyRecordName,
} from "@/lib/base-domain-verification";
import CopyField from "./CopyField";
import BaseDomainActions from "./BaseDomainActions";

/** The row shape this renders — a structural subset of `PartnerDomain`, so the card
 *  can be handed a plain object in a test without dragging the Prisma model along. */
export interface BaseDomainRow {
  id: string;
  domain: string;
  verifyToken: string;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
}

/**
 * One claimed zone: what we know about it, and what the partner has to publish.
 *
 * The TXT instructions stay visible AFTER verification, deliberately. The record must
 * remain published for a re-check to succeed later, and a zone tidy-up that removes
 * "the record Sofra asked for once" is exactly how a partner loses a proof they still
 * qualify for. So the card keeps saying what the record is, for as long as the claim
 * exists.
 */
export default async function BaseDomainCard({
  locale,
  row,
  now,
}: {
  readonly locale: string;
  readonly row: BaseDomainRow;
  readonly now: Date;
}) {
  const t = await getTranslations({ locale, namespace: "control.baseDomain" });
  const age = verificationAge(row.verifiedAt, now);

  return (
    <li className="hand-drawn-border bg-card p-5 grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-hand text-2xl font-bold">{row.domain}</span>
        {row.verifiedAt ? (
          <span
            className={`font-label text-sm ${
              age.stale ? "text-craft-error-text" : "text-craft-success-text dark:text-craft-success"
            }`}
          >
            {t(age.stale ? "statusStale" : "statusVerified", {
              date: shortDate(row.verifiedAt),
            })}
          </span>
        ) : (
          <span className="font-label text-sm text-muted-foreground">
            {t(row.lastCheckedAt ? "statusNotFoundYet" : "statusPending")}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        <p className="font-label text-sm text-muted-foreground">{t("howBody")}</p>
        <dl className="grid gap-2">
          <div className="grid gap-1">
            <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t("recordType")}
            </dt>
            <dd className="font-mono text-sm">TXT</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t("recordName")}
            </dt>
            <dd>
              <CopyField value={verifyRecordName(row.domain)} label={t("recordName")} />
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {t("recordValue")}
            </dt>
            <dd>
              <CopyField value={expectedTxtValue(row.verifyToken)} label={t("recordValue")} />
            </dd>
          </div>
        </dl>
        <p className="font-label text-sm text-muted-foreground">{t("keepRecordNote")}</p>
      </div>

      <BaseDomainActions id={row.id} verified={row.verifiedAt !== null} />
      <p className="font-label text-xs text-muted-foreground">{t("removeNote")}</p>
      {age.stale && <p className="font-label text-sm text-craft-error-text">{t("staleNote")}</p>}
    </li>
  );
}
