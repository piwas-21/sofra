import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import ControlShell from "@/components/control/ControlShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.shell" });

  return (
    <ControlShell
      title={t("admin")}
      userLabel={user.name}
      signOutLabel={t("signOut")}
      nav={[
        { href: "/admin", label: t("nav.applications") },
        { href: "/admin/partners", label: t("nav.partners") },
        { href: "/admin/clients", label: t("nav.clients") },
        { href: "/admin/tenants", label: t("nav.tenants") },
        { href: "/admin/billing", label: t("nav.billing") },
        { href: "/admin/audit", label: t("nav.audit") },
      ]}
    >
      {children}
    </ControlShell>
  );
}
