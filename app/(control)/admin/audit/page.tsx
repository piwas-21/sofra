import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";

export default async function AdminAuditPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.audit" });
  const entries = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: true },
  });

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="font-label text-sm text-muted-foreground border-b-2 border-border">
              <th className="py-2 pr-4">{t("when")}</th>
              <th className="py-2 pr-4">{t("actor")}</th>
              <th className="py-2 pr-4">{t("action")}</th>
              <th className="py-2 pr-4">{t("entity")}</th>
              <th className="py-2">{t("meta")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/60 align-top">
                <td className="py-2 pr-4 whitespace-nowrap">
                  {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="py-2 pr-4">{e.actor?.email ?? "—"}</td>
                <td className="py-2 pr-4">{e.action}</td>
                <td className="py-2 pr-4">
                  {e.entityType ?? ""} {e.entityId ? e.entityId.slice(0, 10) : ""}
                </td>
                <td className="py-2 break-all">{e.meta ? JSON.stringify(e.meta) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
