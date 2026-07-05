import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import SetLiveForm from "@/components/control/SetLiveForm";

export default async function AdminClientsPage() {
  await requireAdmin();
  const clients = await db.client.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { partner: true },
  });
  const onboarding = clients.filter((c) => c.status === "ONBOARDING");
  const rest = clients.filter((c) => c.status !== "ONBOARDING");

  const Row = ({ c }: { c: (typeof clients)[number] }) => (
    <li className="hand-drawn-border bg-card p-5 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="font-hand text-2xl font-bold block">{c.restaurantName}</span>
          <span className="font-label text-sm text-muted-foreground">
            {[c.city, c.contactName, c.email].filter(Boolean).join(" · ") || "—"} · partner:{" "}
            {c.partner.name} · updated {shortDate(c.updatedAt)}
          </span>
        </span>
        <ClientStatusBadge status={c.status} />
      </div>
      {(c.status === "ONBOARDING" || c.status === "LIVE") && (
        <SetLiveForm clientId={c.id} status={c.status} tenantSlug={c.tenantSlug} />
      )}
    </li>
  );

  return (
    <div className="grid gap-10">
      <h1 className="font-display font-bold text-5xl">All clients</h1>

      {onboarding.length > 0 && (
        <section>
          <h2 className="font-hand text-3xl font-bold text-primary">
            Waiting for onboarding ({onboarding.length})
          </h2>
          <p className="mt-1 font-label text-sm text-muted-foreground">
            Provision via the deploy-repo scripts (ADR-003), then set the tenant slug and mark LIVE.
          </p>
          <ul className="mt-4 grid gap-4">
            {onboarding.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-hand text-3xl font-bold text-muted-foreground">Everything else</h2>
        <ul className="mt-4 grid gap-4">
          {rest.map((c) => (
            <Row key={c.id} c={c} />
          ))}
          {rest.length === 0 && <li className="font-label text-muted-foreground">Nothing here.</li>}
        </ul>
      </section>
    </div>
  );
}
