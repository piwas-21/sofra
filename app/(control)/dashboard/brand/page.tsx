import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { prefillFromBillingIdentity } from "@/lib/partner-brand";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import PartnerBrandForm from "@/components/control/PartnerBrandForm";
import PartnerBrandApplyForm from "@/components/control/PartnerBrandApplyForm";
import {
  PARTNER_BRAND_SITE_PAGE_SIZE,
  parsePartnerBrandSiteCursor,
  partnerBrandSitePageHref,
  partnerBrandSiteQuery,
} from "@/lib/partner-brand-sites-pagination";

/**
 * `/dashboard/brand` — the partner's own public details (SOFRA-PARTNER-PLAN §11).
 *
 * `requirePartner()`, not `requirePartnerOrOwner()`, for the reason
 * `/dashboard/domains` states: a direct restaurant owner has one tenant and it is
 * their own, so there is no third party for them to be credited as.
 *
 * Reads are scoped by `partner.id` on both queries — a partner can only ever load
 * their own brand and their own billing identity.
 *
 * Never cached: it renders a row the same request may have just written, and the
 * row is per-user.
 */
export const dynamic = "force-dynamic";

export default async function PartnerBrandPage({
  searchParams,
}: {
  searchParams: Promise<{ siteAfter?: string | string[]; siteBefore?: string | string[] }>;
}) {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.brand" });

  const [brand, registry, query] = await Promise.all([
    db.partnerBrand.findUnique({ where: { partnerId: partner.id } }),
    loadTenantRegistry(),
    searchParams,
  ]);

  // Only consulted when there is no brand yet, and only for a NAME. Looked up by
  // `userId` — the simple link, which is the right one here: this page is about a
  // PARTY, not about one plan, so the plan-scoped `resolveIdentityForPlan` would be
  // answering a question nobody asked. Nothing from this record is stored by
  // loading the page; the partner sees the value in an editable field and saves it
  // themselves (lib/partner-brand.ts explains why only this one field crosses).
  // Read whether or not there is a brand already, because it now answers TWO
  // questions and only the first is about prefilling. The second is D-B1a: a
  // display name that IS the legal name will not be published, so the form has to
  // know the legal name to be able to say so — and a partner whose record has no
  // TRADE name is the one who needs telling before they type, since the only other
  // name we hold is their own. Nothing from this record is stored by loading the
  // page, and none of it is rendered: `legalName` reaches the client as a
  // comparison input, which is a value the partner typed into their own billing
  // record and is being shown their own copy of.
  const identity = await db.billingIdentity.findUnique({
    where: { userId: partner.id },
    select: { legalName: true, tradeName: true },
  });
  const prefill = brand ? null : prefillFromBillingIdentity(identity);
  const eligibleSlugs = new Set(
    registry.ok
      ? registry.tenants
          .filter((tenant) => tenant.status === "active" && tenant.managed === "scripts")
          .map((tenant) => tenant.slug)
      : [],
  );
  const eligibleSlugList = [...eligibleSlugs];
  const requestedCursor = parsePartnerBrandSiteCursor(query);
  const cursorClient = requestedCursor
    ? await db.client.findUnique({
        where: { id: requestedCursor.clientId },
        select: { id: true, restaurantName: true, partnerId: true, status: true, tenantSlug: true },
      })
    : null;
  const cursorIsEligible = Boolean(
    cursorClient &&
      cursorClient.partnerId === partner.id &&
      cursorClient.status === "LIVE" &&
      cursorClient.tenantSlug &&
      eligibleSlugs.has(cursorClient.tenantSlug),
  );
  let activeCursor = cursorIsEligible && cursorClient && requestedCursor
    ? { direction: requestedCursor.direction, boundary: cursorClient }
    : null;
  const fetchSites = (cursor: typeof activeCursor) =>
    db.client.findMany({
      ...partnerBrandSiteQuery(partner.id, eligibleSlugList, cursor),
      select: { id: true, restaurantName: true, tenantSlug: true },
    });
  let rows = eligibleSlugList.length > 0 ? await fetchSites(activeCursor) : [];
  if (activeCursor && rows.length === 0) {
    activeCursor = null;
    rows = eligibleSlugList.length > 0 ? await fetchSites(null) : [];
  }

  const hasExtraSite = rows.length > PARTNER_BRAND_SITE_PAGE_SIZE;
  const visibleRows = rows.slice(0, PARTNER_BRAND_SITE_PAGE_SIZE);
  const sites = activeCursor?.direction === "before" ? visibleRows.reverse() : visibleRows;
  const hasPreviousSites = activeCursor?.direction === "after" ||
    (activeCursor?.direction === "before" && hasExtraSite);
  const hasNextSites = activeCursor?.direction === "before" ? true : hasExtraSite;
  const previousHref = hasPreviousSites && sites.length > 0
    ? partnerBrandSitePageHref("before", sites[0].id)
    : null;
  const nextHref = hasNextSites && sites.length > 0
    ? partnerBrandSitePageHref("after", sites[sites.length - 1].id)
    : null;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
        <p className="mt-2 font-label text-sm text-muted-foreground">{t("privacyNote")}</p>
      </div>

      <section className="grid gap-4">
        {!brand && prefill && (
          <p className="font-label text-sm text-muted-foreground">{t("prefillNote")}</p>
        )}
        <PartnerBrandForm
          defaults={brand ?? prefill ?? undefined}
          legalName={identity?.legalName}
          hasTradeName={Boolean(identity?.tradeName?.trim())}
        />
      </section>

      <section className="hand-drawn-border bg-card p-6 grid gap-4">
        <div>
          <h2 className="font-hand text-3xl font-bold">{t("existingSitesTitle")}</h2>
          <p className="mt-2 font-label text-sm text-muted-foreground">{t("existingSitesIntro")}</p>
        </div>
        {!registry.ok ? (
          <p className="font-label text-sm text-muted-foreground">{t("sitesUnavailable")}</p>
        ) : sites.length === 0 ? (
          <p className="font-label text-sm text-muted-foreground">{t("noExistingSites")}</p>
        ) : (
          <ul className="grid gap-4">
            {sites.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-4 rounded-craft border-2 border-border p-4">
                <div className="grid gap-1">
                  <span className="font-label font-bold">{client.restaurantName}</span>
                  <code className="font-mono text-xs text-muted-foreground">{client.tenantSlug}</code>
                </div>
                <PartnerBrandApplyForm clientId={client.id} />
              </li>
            ))}
          </ul>
        )}
        {sites.length > 0 && (previousHref || nextHref) && (
          <nav aria-label={t("existingSitesTitle")} className="flex justify-between gap-4">
            {previousHref ? (
              <Link href={previousHref} className="font-label text-sm underline">{t("previousSites")}</Link>
            ) : <span />}
            {nextHref && (
              <Link href={nextHref} className="font-label text-sm underline">{t("nextSites")}</Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
