import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { eur } from "@/lib/format";
import { BILLING_INTERVALS } from "@/lib/billing";
import { loadTenantRegistry, type RegistryTenant } from "@/lib/tenant-registry";

// The registry file changes underneath us (rsync on deploy-repo push) — always
// re-read instead of serving a build-time snapshot.
export const dynamic = "force-dynamic";

// Same shape/helper as the sibling /admin/billing page.
type BillingSummary = {
  id: string;
  subscriptions: { status: string; amountCents: number; interval: string }[];
};

const intervalLabel = (mollie: string) =>
  Object.values(BILLING_INTERVALS).find((i) => i.mollie === mollie)?.label ?? mollie;

function statusTone(status: string) {
  if (status === "active") return "text-craft-success-text dark:text-craft-success";
  if (status === "retired") return "text-muted-foreground";
  return ""; // provisioning et al — default ink
}

function BillingCell({ billing }: { billing?: BillingSummary }) {
  if (!billing) {
    return <span className="text-muted-foreground">no billing account</span>;
  }
  const active = billing.subscriptions.filter((s) => s.status === "ACTIVE");
  const pending = billing.subscriptions.filter((s) => s.status !== "ACTIVE" && s.status !== "CANCELED");
  return (
    <Link href={`/admin/billing/${billing.id}`} className="underline">
      {active.length > 0
        ? active.map((s) => `${eur(s.amountCents)} · ${intervalLabel(s.interval)}`).join(", ")
        : pending.length > 0
          ? `${pending.length} plan(s) awaiting activation`
          : "no active plan"}
    </Link>
  );
}

function TenantCard({ tenant, billing }: { tenant: RegistryTenant; billing?: BillingSummary }) {
  return (
    <li className="hand-drawn-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="font-hand text-2xl font-bold">{tenant.slug}</span>
          <span className={`ml-3 font-label text-sm ${statusTone(tenant.status)}`}>
            {tenant.status}
          </span>
          {tenant.managed === "legacy" && (
            <span className="ml-2 font-label text-sm text-muted-foreground">
              (legacy — scripts refuse it)
            </span>
          )}
          <span className="font-label text-sm text-muted-foreground block">
            {tenant.name}
            {tenant.city ? ` · ${tenant.city}` : ""} ·{" "}
            <a href={`https://${tenant.domain}`} className="underline" target="_blank" rel="noreferrer">
              {tenant.domain}
            </a>{" "}
            · {tenant.box} box · db {tenant.db}
          </span>
        </span>
        <span className="font-label text-sm text-right">
          <span className="block">
            <BillingCell billing={billing} />
          </span>
          <span className="block text-muted-foreground">
            {tenant.currency ?? "EUR"} · {tenant.languages.length} lang · modules:{" "}
            {tenant.modules.join(", ") || "—"}
          </span>
        </span>
      </div>
    </li>
  );
}

export default async function AdminTenantsPage() {
  await requireAdmin();
  const registry = await loadTenantRegistry();
  const billings = await db.tenantBilling.findMany({
    select: {
      id: true,
      tenantSlug: true,
      subscriptions: { select: { status: true, amountCents: true, interval: true } },
    },
  });
  const billingBySlug = new Map(billings.map((b) => [b.tenantSlug, b]));

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">Tenants</h1>
        <p className="mt-2 font-label text-muted-foreground">
          Read-only view of the deploy repo&apos;s tenant registry (ADR-007). Lifecycle changes go
          through git + the provision scripts (ADR-003), not this page.
        </p>
      </div>

      {!registry.ok ? (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          Tenant registry unavailable: {registry.error}
        </p>
      ) : (
        <section>
          <h2 className="font-hand text-3xl font-bold">Registered ({registry.tenants.length})</h2>
          <ul className="mt-4 grid gap-4">
            {registry.tenants.map((t) => (
              <TenantCard key={t.slug} tenant={t} billing={billingBySlug.get(t.slug)} />
            ))}
            {registry.tenants.length === 0 && (
              <li className="font-label text-muted-foreground">Registry is empty.</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
