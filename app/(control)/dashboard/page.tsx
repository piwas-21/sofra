import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import ClientForm from "@/components/control/ClientForm";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";

export default async function DashboardPage() {
  const partner = await requirePartner();
  const clients = await db.client.findMany({
    where: { partnerId: partner.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">Your clients</h1>
        <p className="mt-2 text-muted-foreground">
          Every restaurant you bring to the table, from first call to live service.
        </p>
      </div>

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">Add a client</h2>
        <div className="mt-4">
          <ClientForm />
        </div>
      </section>

      {clients.length === 0 ? (
        <p className="font-hand text-2xl text-muted-foreground">
          No clients yet — add the first restaurant above.
        </p>
      ) : (
        <ul className="grid gap-4">
          {clients.map((c) => (
            <li key={c.id}>
              <a
                href={`/dashboard/clients/${c.id}`}
                className="hand-drawn-border bg-card p-5 flex flex-wrap items-center justify-between gap-3 hover:rotate-[-0.3deg] transition-transform"
              >
                <span className="min-w-0">
                  <span className="font-hand text-2xl font-bold block truncate">
                    {c.restaurantName}
                  </span>
                  <span className="font-label text-sm text-muted-foreground">
                    {[c.city, c.contactName].filter(Boolean).join(" · ") || "—"} · updated{" "}
                    {shortDate(c.updatedAt)}
                  </span>
                </span>
                <ClientStatusBadge status={c.status} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
