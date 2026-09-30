import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { printerAgentFresh, printerTenantEligible } from "@/lib/printer-access-policy";
import { printerCredentialsConfigured } from "@/lib/printer-credential-crypto";
import PrinterAccessCard from "@/components/control/PrinterAccessCard";

export const dynamic = "force-dynamic";
export default async function AdminPrintersPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.printers" });
  const registry = await loadTenantRegistry();
  const tenants = registry.ok ? registry.tenants.filter(printerTenantEligible) : [];
  // Metadata only: ciphertext never enters the server-rendered page or RSC payload.
  const credentials = await db.printerCredential.findMany({
    where: { tenantSlug: { in: tenants.map((t) => t.slug) } },
    select: { tenantSlug: true, keyFingerprint: true, pendingFingerprint: true, lastSyncedAt: true, verified: true, renewable: true, box: true, renewalFailed: true },
  });
  const bySlug = new Map(credentials.map((c) => [c.tenantSlug, c]));
  const enabled = printerCredentialsConfigured();
  return <div className="grid gap-8">
    <div><h1 className="font-display font-bold text-5xl">{t("title")}</h1>
      <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p></div>
    {!registry.ok && <p role="alert">{t("registryUnavailable")}</p>}
    {!enabled && <p role="alert">{t("configurationMissing")}</p>}
    {registry.ok && tenants.length === 0 && <p className="font-label">{t("empty")}</p>}
    <ul className="grid gap-4">{tenants.map((tenant) => {
      const row = bySlug.get(tenant.slug);
      const c = row?.box === tenant.box ? row : undefined;
      return <PrinterAccessCard key={tenant.slug + (c?.pendingFingerprint ?? "")}
        slug={tenant.slug} name={tenant.name} apiUrl={`https://${tenant.domain}`}
        failed={!!c?.renewalFailed} enabled={enabled && !!c?.renewable} pending={!!c?.pendingFingerprint} reported={printerAgentFresh(c?.lastSyncedAt ?? null)}
        ready={enabled && !!c?.keyFingerprint && !!c.verified && printerAgentFresh(c.lastSyncedAt)}
        fingerprint={c?.keyFingerprint?.slice(0, 12) ?? null} syncedAt={c?.lastSyncedAt?.toISOString() ?? null} />;
    })}</ul>
  </div>;
}
