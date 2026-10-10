import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { prefillFromBillingIdentity } from "@/lib/partner-brand";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { partnerBrandRuntimeConfig } from "@/lib/partner-brand-config";
import PartnerBrandForm from "@/components/control/PartnerBrandForm";
import { renderableBrand } from "@/lib/partner-brand";
import PartnerBrandApplyForm from "@/components/control/PartnerBrandApplyForm";
import {
  assemblePartnerBrandSitesPage,
  eligiblePartnerBrandCursorBoundary,
  parsePartnerBrandSiteCursor,
  partnerBrandSiteQuery,
  type ActivePartnerBrandSiteCursor,
  type PartnerBrandSitesPage,
  type PartnerBrandSiteRow,
} from "@/lib/partner-brand-sites-pagination";

type PartnerBrandPageSearchParams = Readonly<{
  siteAfter?: string | string[];
  siteBefore?: string | string[];
}>;
type PartnerBrandPageProps = Readonly<{ searchParams: Promise<PartnerBrandPageSearchParams> }>;

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

async function fetchPartnerBrandSiteRows(
  partnerId: string,
  eligibleSlugs: string[],
  cursor: ActivePartnerBrandSiteCursor,
  pageSize: number,
): Promise<PartnerBrandSiteRow[]> {
  if (eligibleSlugs.length === 0) return [];
  return await db.client.findMany({
    ...partnerBrandSiteQuery(partnerId, eligibleSlugs, pageSize, cursor),
    select: { id: true, restaurantName: true, tenantSlug: true },
  });
}

async function loadPartnerBrandSitesPage(
  partnerId: string,
  eligibleSlugSet: Set<string>,
  search: PartnerBrandPageSearchParams,
  pageSize: number,
): Promise<PartnerBrandSitesPage> {
  const eligibleSlugs = [...eligibleSlugSet];
  const requestedCursor = parsePartnerBrandSiteCursor(search);
  const cursorClient = requestedCursor
    ? await db.client.findUnique({
        where: { id: requestedCursor.clientId },
        select: { id: true, restaurantName: true, partnerId: true, status: true, tenantSlug: true },
      })
    : null;
  const boundary = eligiblePartnerBrandCursorBoundary(cursorClient, partnerId, eligibleSlugSet);
  let activeCursor: ActivePartnerBrandSiteCursor = requestedCursor && boundary
    ? { direction: requestedCursor.direction, boundary }
    : null;
  let rows = await fetchPartnerBrandSiteRows(partnerId, eligibleSlugs, activeCursor, pageSize);
  if (activeCursor && rows.length === 0) {
    activeCursor = null;
    rows = await fetchPartnerBrandSiteRows(partnerId, eligibleSlugs, null, pageSize);
  }
  return assemblePartnerBrandSitesPage(rows, activeCursor, pageSize);
}

export default async function PartnerBrandPage({ searchParams }: PartnerBrandPageProps) {
  const partner = await requirePartner();
  const { sitePageSize } = partnerBrandRuntimeConfig();
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
          .filter((tenant) => tenant.status === "active")
          .map((tenant) => tenant.slug)
      : [],
  );
  const sitePage = await loadPartnerBrandSitesPage(partner.id, eligibleSlugs, query, sitePageSize);
  const preferences = await db.tenantBranding.findMany({
    where: { tenantSlug: { in: sitePage.sites.flatMap((site) => site.tenantSlug ? [site.tenantSlug] : []) } },
  });
  const enabledSites = new Map(preferences.map((row) => [row.tenantSlug, row.enabled]));
  const publishable = Boolean(renderableBrand(brand, { legalName: identity?.legalName }));
  let siteMessage: string | null = null;
  if (!registry.ok) siteMessage = t("sitesUnavailable");
  else if (sitePage.sites.length === 0) siteMessage = t("noExistingSites");

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
          <p className="mt-2 font-label text-sm text-muted-foreground">{t("runtimeIntro")}</p>
        </div>
        {siteMessage ? (
          <p className="font-label text-sm text-muted-foreground">{siteMessage}</p>
        ) : (
          <ul className="grid gap-4">
            {sitePage.sites.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-4 rounded-craft border-2 border-border p-4">
                <div className="grid gap-1">
                  <span className="font-label font-bold">{client.restaurantName}</span>
                  <code className="font-mono text-xs text-muted-foreground">{client.tenantSlug}</code>
                </div>
                <PartnerBrandApplyForm clientId={client.id}
                  enabled={enabledSites.get(client.tenantSlug ?? "") ?? true}
                  publishable={publishable}
                  optedOut={registry.ok && registry.tenants.some((tenant) => tenant.slug === client.tenantSlug && tenant.partner_attribution === false)} />
              </li>
            ))}
          </ul>
        )}
        {sitePage.sites.length > 0 && (sitePage.previousHref || sitePage.nextHref) && (
          <nav aria-label={t("existingSitesTitle")} className="flex justify-between gap-4">
            {sitePage.previousHref ? (
              <Link href={sitePage.previousHref} className="font-label text-sm underline">{t("previousSites")}</Link>
            ) : <span />}
            {sitePage.nextHref && (
              <Link href={sitePage.nextHref} className="font-label text-sm underline">{t("nextSites")}</Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
