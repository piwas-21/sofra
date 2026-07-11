import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import ControlShell from "@/components/control/ControlShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.shell" });

  // Derive the partner "type" from what they actually have (SOFRA-PARTNER-PLAN):
  // a reseller pays (has billing) and sees Plan; a commission partner earns and
  // sees Ledger. A pure reseller doesn't get shown an empty ledger; existing
  // commission partners are unchanged (no billing → Ledger stays).
  const [billingCount, commissionCount] = await Promise.all([
    db.tenantBilling.count({ where: { client: { partnerId: user.id } } }),
    db.commissionEntry.count({ where: { partnerId: user.id } }),
  ]);
  const hasBilling = billingCount > 0;
  const hasCommissions = commissionCount > 0;

  const nav = [{ href: "/dashboard", label: t("nav.clients") }];
  if (hasBilling) nav.push({ href: "/dashboard/billing", label: t("nav.plan") });
  if (hasCommissions || !hasBilling) nav.push({ href: "/dashboard/ledger", label: t("nav.ledger") });

  return (
    <ControlShell title={t("partner")} userLabel={user.name} signOutLabel={t("signOut")} nav={nav}>
      {children}
    </ControlShell>
  );
}
