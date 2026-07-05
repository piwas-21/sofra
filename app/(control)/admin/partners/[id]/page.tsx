import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { chf, shortDate } from "@/lib/format";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import CommissionForm from "@/components/control/CommissionForm";

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const partner = await db.user.findFirst({
    where: { id, role: "PARTNER" },
    include: {
      profile: true,
      clients: { orderBy: { updatedAt: "desc" } },
      commissions: { orderBy: { createdAt: "desc" }, include: { client: true } },
    },
  });
  if (!partner) notFound();

  const balance = partner.commissions.reduce((s, c) => s + c.amountCents, 0);

  return (
    <div className="grid gap-10">
      <div>
        <a href="/admin/partners" className="font-label text-sm text-muted-foreground underline">
          ← All partners
        </a>
        <h1 className="mt-3 font-display font-bold text-5xl">{partner.name}</h1>
        <p className="mt-2 font-label text-muted-foreground">
          {partner.email}
          {partner.profile?.company ? ` · ${partner.profile.company}` : ""}
          {partner.profile?.city ? ` · ${partner.profile.city}` : ""} · {partner.status} · joined{" "}
          {shortDate(partner.createdAt)}
        </p>
      </div>

      <section>
        <h2 className="font-hand text-3xl font-bold">Clients</h2>
        <ul className="mt-4 grid gap-2">
          {partner.clients.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3">
              <ClientStatusBadge status={c.status} />
              <span>{c.restaurantName}</span>
              <span className="font-label text-sm text-muted-foreground">{c.city ?? ""}</span>
            </li>
          ))}
          {partner.clients.length === 0 && (
            <li className="font-label text-muted-foreground">No clients yet.</li>
          )}
        </ul>
      </section>

      <section className="hand-drawn-border bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-hand text-3xl font-bold">Commission ledger</h2>
          <p className="font-display font-bold text-3xl text-primary">{chf(balance)}</p>
        </div>
        <div className="mt-4">
          <CommissionForm
            partnerId={partner.id}
            clients={partner.clients.map((c) => ({ id: c.id, restaurantName: c.restaurantName }))}
          />
        </div>
        <ul className="mt-6 grid gap-2">
          {partner.commissions.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-3 font-label text-sm">
              <span className="font-mono text-xs text-muted-foreground">{shortDate(e.createdAt)}</span>
              <span className={`font-mono ${e.amountCents < 0 ? "text-destructive" : ""}`}>
                {chf(e.amountCents)}
              </span>
              <span>{e.note}</span>
              <span className="text-muted-foreground">{e.client?.restaurantName ?? ""}</span>
            </li>
          ))}
          {partner.commissions.length === 0 && (
            <li className="font-label text-muted-foreground">Nothing recorded yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
