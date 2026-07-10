import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur } from "@/lib/format";

export default async function AdminPartnersPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.partners" });
  const partners = await db.user.findMany({
    where: { role: "PARTNER" },
    orderBy: { createdAt: "desc" },
    include: {
      profile: true,
      _count: { select: { clients: true } },
      commissions: { select: { amountCents: true } },
    },
  });

  return (
    <div className="grid gap-8">
      <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
      {partners.length === 0 && (
        <p className="font-hand text-2xl text-muted-foreground">{t("empty")}</p>
      )}
      <ul className="grid gap-4">
        {partners.map((p) => {
          const balance = p.commissions.reduce((s, c) => s + c.amountCents, 0);
          return (
            <li key={p.id}>
              <a
                href={`/admin/partners/${p.id}`}
                className="hand-drawn-border bg-card p-5 flex flex-wrap items-center justify-between gap-3 hover:rotate-[-0.3deg] transition-transform"
              >
                <span>
                  <span className="font-hand text-2xl font-bold block">{p.name}</span>
                  <span className="font-label text-sm text-muted-foreground">
                    {p.email}
                    {p.profile?.company ? ` · ${p.profile.company}` : ""}
                    {p.profile?.city ? ` · ${p.profile.city}` : ""} · {p.status}
                  </span>
                </span>
                <span className="font-label text-sm text-muted-foreground text-right">
                  {t("clientCount", { count: p._count.clients })}
                  <span className="block font-mono">{eur(balance)}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
