import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import ControlShell from "@/components/control/ControlShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.shell" });

  return (
    <ControlShell
      title={t("partner")}
      userLabel={user.name}
      signOutLabel={t("signOut")}
      nav={[
        { href: "/dashboard", label: t("nav.clients") },
        { href: "/dashboard/ledger", label: t("nav.ledger") },
      ]}
    >
      {children}
    </ControlShell>
  );
}
