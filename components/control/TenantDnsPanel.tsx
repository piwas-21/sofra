import { getTranslations } from "next-intl/server";
import type { TenantDnsRecord } from "@/lib/tenant-dns-record";
import type { DnsRecordState } from "@/lib/tenant-dns-check";
import CopyField from "./CopyField";

export interface TenantDnsRow {
  record: TenantDnsRecord;
  state: DnsRecordState;
}

/** Colour follows the news, not the layout: only `missing` is something the partner
 *  must go and do, and only `ok` is finished. */
const STATUS_CLASS: Record<DnsRecordState["status"], string> = {
  ok: "text-craft-success-text dark:text-craft-success",
  elsewhere: "text-craft-error-text",
  missing: "text-craft-error-text",
  unknown: "text-muted-foreground",
};

/**
 * The DNS a live tenant's addresses depend on, and whether it is there yet.
 *
 * Shown for as long as the tenant exists, deliberately — the same reasoning
 * `BaseDomainCard` gives for keeping its TXT instructions after verification. A
 * record that is deleted during a zone tidy-up takes the restaurant off the internet
 * at the next certificate renewal, and a card that disappeared once the tenant went
 * live is a card that cannot warn anybody about that.
 *
 * Renders nothing when there is nothing to publish (a tenant on our own base domain
 * rides the wildcard) — an empty "DNS" panel would invite a partner to look for work
 * that does not exist.
 */
export default async function TenantDnsPanel({
  locale,
  rows,
  boxIp,
}: {
  readonly locale: string;
  readonly rows: readonly TenantDnsRow[];
  readonly boxIp?: string;
}) {
  if (rows.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "control.tenantDns" });

  return (
    <section className="hand-drawn-border bg-card p-6">
      <h2 className="font-hand text-3xl font-bold">{t("title")}</h2>
      <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>

      <ul className="mt-4 grid gap-4">
        {rows.map(({ record, state }) => (
          <li key={record.host} className="hand-drawn-border bg-muted/40 p-5 grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-mono text-sm break-all">{record.host}</span>
              <span className={`font-label text-sm ${STATUS_CLASS[state.status]}`}>
                {t(`status.${state.status}`)}
              </span>
            </div>

            {record.alias && (
              <p className="font-label text-sm text-muted-foreground">{t("aliasNote")}</p>
            )}

            <p className="font-label text-sm text-muted-foreground">
              {t(record.publishedBy === "partner" ? "whoPartner" : "whoRestaurant", {
                zone: record.zone,
              })}
            </p>

            <dl className="grid gap-2">
              <div className="grid gap-1">
                <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {t("recordType")}
                </dt>
                <dd className="font-mono text-sm">{record.type}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {t("recordName")}
                </dt>
                <dd className="grid gap-1">
                  <CopyField value={record.name} label={t("recordName")} />
                  {/* Zone editors disagree about whether "name" means the label or the
                      whole hostname, and a partner who guesses wrong creates
                      `obresse.obresse.solutioneva.com`. Print both. */}
                  {record.name !== record.host && (
                    <span className="font-label text-xs text-muted-foreground">
                      {t("fqdnNote", { host: record.host })}
                    </span>
                  )}
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
                      {t("valueUnknown")}
                    </span>
                  )}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {t("recordTtl")}
                </dt>
                <dd className="font-mono text-sm">7200</dd>
              </div>
            </dl>

            {state.status === "elsewhere" && (
              <p className="font-label text-sm text-craft-error-text">
                {t("elsewhereNote", { addresses: state.addresses.join(", ") })}
              </p>
            )}
            {state.status === "missing" && (
              <p className="font-label text-sm text-craft-error-text">{t("missingNote")}</p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 font-label text-xs text-muted-foreground">{t("footerNote")}</p>
    </section>
  );
}
