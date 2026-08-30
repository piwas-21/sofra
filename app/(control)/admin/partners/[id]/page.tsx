import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { verificationAge } from "@/lib/base-domain-verification";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import CommissionForm from "@/components/control/CommissionForm";

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.partnerDetail" });
  // The partner-facing namespace, reused here on purpose: the founder should read
  // the same words for these fields that the partner does, or the two pages drift
  // into describing the same record differently (§11).
  const tb = await getTranslations({ locale, namespace: "control.brand" });
  const { id } = await params;
  const partner = await db.user.findFirst({
    where: { id, role: "PARTNER" },
    include: {
      profile: true,
      clients: { orderBy: { updatedAt: "desc" } },
      commissions: { orderBy: { createdAt: "desc" }, include: { client: true } },
      // The zones this partner may put clients under (D1). The founder is the only
      // person who can see a partner's proof AGE, and staleness is deliberately
      // surfaced rather than acted on — nothing auto-revokes (lib/base-domain-
      // verification.ts). This is where "is that still theirs?" gets asked.
      baseDomains: { orderBy: [{ verifiedAt: "desc" }, { createdAt: "desc" }] },
      // Read-only here (§11). The founder needs to see what a partner would be
      // published AS — and, more to the point, whether they have ASKED to be
      // published — before the owner decision in §11e is taken. Nothing on this
      // page writes it: the record belongs to the partner.
      brand: true,
    },
  });
  if (!partner) notFound();

  const balance = partner.commissions.reduce((s, c) => s + c.amountCents, 0);
  // Joined once each so an all-empty line renders nothing at all rather than a row
  // of separators.
  const contact = [partner.brand?.email, partner.brand?.phone].filter(Boolean).join(" · ");
  const address = [
    partner.brand?.addressLine1,
    partner.brand?.postalCode,
    partner.brand?.city,
    partner.brand?.countryCode,
  ]
    .filter(Boolean)
    .join(" · ");
  // One clock for the whole render, so two domains never disagree about staleness.
  const now = new Date();

  return (
    <div className="grid gap-10">
      <div>
        <Link href="/admin/partners" className="font-label text-sm text-muted-foreground underline">
          {t("back")}
        </Link>
        <h1 className="mt-3 font-display font-bold text-5xl">{partner.name}</h1>
        <p className="mt-2 font-label text-muted-foreground">
          {partner.email}
          {partner.profile?.company ? ` · ${partner.profile.company}` : ""}
          {partner.profile?.city ? ` · ${partner.profile.city}` : ""} · {partner.status} ·{" "}
          {t("joined", { date: shortDate(partner.createdAt) })}
        </p>
      </div>

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("clients")}</h2>
        <ul className="mt-4 grid gap-2">
          {partner.clients.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3">
              <ClientStatusBadge status={c.status} />
              <span>{c.restaurantName}</span>
              <span className="font-label text-sm text-muted-foreground">{c.city ?? ""}</span>
            </li>
          ))}
          {partner.clients.length === 0 && (
            <li className="font-label text-muted-foreground">{t("noClients")}</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("baseDomains")}</h2>
        <ul className="mt-4 grid gap-2">
          {partner.baseDomains.map((d) => {
            const age = verificationAge(d.verifiedAt, now);
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 font-label text-sm">
                <code className="font-mono text-xs bg-muted/60 rounded-craft px-2 py-1">
                  {d.domain}
                </code>
                {d.verifiedAt ? (
                  <span className={age.stale ? "text-craft-error-text" : "text-muted-foreground"}>
                    {t(age.stale ? "baseDomainStale" : "baseDomainVerified", {
                      date: shortDate(d.verifiedAt),
                      days: age.ageDays ?? 0,
                    })}
                  </span>
                ) : (
                  <span className="text-craft-error-text">{t("baseDomainUnverified")}</span>
                )}
              </li>
            );
          })}
          {partner.baseDomains.length === 0 && (
            <li className="font-label text-muted-foreground">{t("noBaseDomains")}</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">{tb("adminTitle")}</h2>
        {partner.brand ? (
          <div className="mt-4 grid gap-1 font-label text-sm">
            <span className="font-bold">{partner.brand.displayName}</span>
            {partner.brand.tagline && (
              <span className="text-muted-foreground">{partner.brand.tagline}</span>
            )}
            {partner.brand.websiteUrl && (
              // `rel="noopener noreferrer"` because this is a partner-supplied
              // address opened from an admin page; the https-only check at the write
              // schema is the other half (lib/partner-brand.ts).
              <a
                href={partner.brand.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground underline w-fit"
              >
                {partner.brand.websiteUrl}
              </a>
            )}
            {contact && <span className="text-muted-foreground">{contact}</span>}
            {address.length > 0 && <span className="text-muted-foreground">{address}</span>}
            <span className={partner.brand.publishToTenants ? "" : "text-muted-foreground"}>
              {tb(partner.brand.publishToTenants ? "adminPublishAsked" : "adminPublishOff")}
            </span>
          </div>
        ) : (
          <p className="mt-4 font-label text-muted-foreground">{tb("adminEmpty")}</p>
        )}
      </section>

      <section className="hand-drawn-border bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-hand text-3xl font-bold">{t("ledger")}</h2>
          <p className="font-display font-bold text-3xl text-primary">{eur(balance)}</p>
        </div>
        <div className="mt-4">
          <CommissionForm
            partnerId={partner.id}
            clients={partner.clients.map((c) => ({ id: c.id, restaurantName: c.restaurantName }))}
          />
        </div>
        <ul className="mt-6 grid gap-2">
          {partner.commissions.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-3 font-label text-sm">
              <span className="font-mono text-xs text-muted-foreground">{shortDate(e.createdAt)}</span>
              <span className={`font-mono ${e.amountCents < 0 ? "text-destructive" : ""}`}>
                {eur(e.amountCents)}
              </span>
              <span>{e.note}</span>
              <span className="text-muted-foreground">{e.client?.restaurantName ?? ""}</span>
            </li>
          ))}
          {partner.commissions.length === 0 && (
            <li className="font-label text-muted-foreground">{t("empty")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
