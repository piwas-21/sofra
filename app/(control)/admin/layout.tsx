import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import ControlShell from "@/components/control/ControlShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.shell" });

  // Grouped by the question each section answers — who wants to buy, who is
  // running, what is being charged, what happened — not by the order the pages
  // were built. Ten equal-weight links in a header row was a list to scan
  // rather than a structure to navigate.
  return (
    <ControlShell
      title={t("admin")}
      userLabel={user.name}
      signOutLabel={t("signOut")}
      groups={[
        {
          label: t("groups.pipeline"),
          items: [
            { href: "/admin", label: t("nav.applications") },
            { href: "/admin/signups", label: t("nav.signups") },
            { href: "/admin/partners", label: t("nav.partners") },
            { href: "/admin/clients", label: t("nav.clients") },
          ],
        },
        {
          label: t("groups.tenants"),
          items: [
            { href: "/admin/tenants", label: t("nav.tenants") },
            { href: "/admin/provision", label: t("nav.provision") },
            { href: "/admin/onboard", label: t("nav.onboard") },
            { href: "/admin/fleet", label: t("nav.fleet") },
            { href: "/admin/backups", label: t("nav.backups") },
            { href: "/admin/cron", label: t("nav.cron") },
          ],
        },
        {
          label: t("groups.money"),
          items: [
            { href: "/admin/billing", label: t("nav.billing") },
            { href: "/admin/invoices", label: t("nav.invoices") },
            { href: "/admin/icp", label: t("nav.icp") },
          ],
        },
        {
          label: t("groups.system"),
          items: [{ href: "/admin/audit", label: t("nav.audit") }],
        },
      ]}
    >
      {children}
    </ControlShell>
  );
}
