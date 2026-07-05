import { requirePartner } from "@/lib/rbac";
import ControlShell from "@/components/control/ControlShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePartner();

  return (
    <ControlShell
      title="Partner"
      userLabel={user.name}
      nav={[
        { href: "/dashboard", label: "Clients" },
        { href: "/dashboard/ledger", label: "Ledger" },
      ]}
    >
      {children}
    </ControlShell>
  );
}
