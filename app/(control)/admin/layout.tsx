import { requireAdmin } from "@/lib/rbac";
import ControlShell from "@/components/control/ControlShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();

  return (
    <ControlShell
      title="Admin"
      userLabel={user.name}
      nav={[
        { href: "/admin", label: "Applications" },
        { href: "/admin/partners", label: "Partners" },
        { href: "/admin/clients", label: "Clients" },
        { href: "/admin/billing", label: "Billing" },
        { href: "/admin/audit", label: "Audit" },
      ]}
    >
      {children}
    </ControlShell>
  );
}
