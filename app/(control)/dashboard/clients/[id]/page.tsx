import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import ClientForm from "@/components/control/ClientForm";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import ClientPipelineControls from "@/components/control/ClientPipelineControls";
import NoteForm from "@/components/control/NoteForm";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const partner = await requirePartner();
  const { id } = await params;
  const client = await db.client.findFirst({
    where: { id, partnerId: partner.id },
    include: {
      clientNotes: { orderBy: { createdAt: "desc" }, include: { author: true } },
    },
  });
  if (!client) notFound();

  return (
    <div className="grid gap-10">
      <div>
        <a href="/dashboard" className="font-label text-sm text-muted-foreground underline">
          ← All clients
        </a>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <h1 className="font-display font-bold text-5xl">{client.restaurantName}</h1>
          <ClientStatusBadge status={client.status} />
          {client.tenantSlug && (
            <code className="font-mono text-xs bg-muted/60 rounded-craft px-2 py-1">
              {client.tenantSlug}
            </code>
          )}
        </div>
      </div>

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">Pipeline</h2>
        <div className="mt-4">
          <ClientPipelineControls clientId={client.id} status={client.status} />
        </div>
      </section>

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">Details</h2>
        <div className="mt-4">
          <ClientForm client={client} />
        </div>
      </section>

      <section className="ruled-lines hand-drawn-border bg-muted/40 p-6">
        <h2 className="font-hand text-3xl font-bold">Notes</h2>
        <div className="mt-4">
          <NoteForm clientId={client.id} />
        </div>
        <ul className="mt-6 grid gap-4">
          {client.clientNotes.map((n) => (
            <li key={n.id} className="bg-card rounded-craft border-2 border-border p-4">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-2 font-label text-xs text-muted-foreground">
                {n.author.name} · {shortDate(n.createdAt)}
              </p>
            </li>
          ))}
          {client.clientNotes.length === 0 && (
            <li className="font-label text-muted-foreground">No notes yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
