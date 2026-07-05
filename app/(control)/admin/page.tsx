import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import ApplicationActions from "@/components/control/ApplicationActions";

export default async function AdminApplicationsPage() {
  await requireAdmin();
  const [pending, decided] = await Promise.all([
    db.partnerApplication.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    }),
    db.partnerApplication.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { decidedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">Partner applications</h1>
        <p className="mt-2 text-muted-foreground">
          {pending.length === 0 ? "Queue is empty." : `${pending.length} waiting for a decision.`}
        </p>
      </div>

      <ul className="grid gap-6">
        {pending.map((a) => (
          <li key={a.id} className="hand-drawn-border bg-card p-6 grid gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-hand text-3xl font-bold">{a.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">
                {shortDate(a.createdAt)} · {a.locale}
              </span>
            </div>
            <p className="font-label text-sm text-muted-foreground">
              {a.email}
              {a.company ? ` · ${a.company}` : ""}
              {a.city ? ` · ${a.city}` : ""}
            </p>
            <p className="whitespace-pre-wrap">{a.message}</p>
            <ApplicationActions id={a.id} />
          </li>
        ))}
      </ul>

      {decided.length > 0 && (
        <section>
          <h2 className="font-hand text-3xl font-bold text-muted-foreground">Recently decided</h2>
          <ul className="mt-4 grid gap-2">
            {decided.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-3 font-label text-sm text-muted-foreground">
                <span className={a.status === "APPROVED" ? "text-craft-success-text dark:text-craft-success" : "text-destructive"}>
                  {a.status}
                </span>
                <span>{a.name}</span>
                <span>{a.email}</span>
                <span>{a.decidedAt ? shortDate(a.decidedAt) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
