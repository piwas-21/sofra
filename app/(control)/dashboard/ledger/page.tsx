import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";

export default async function LedgerPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.ledger" });
  const entries = await db.commissionEntry.findMany({
    where: { partnerId: partner.id },
    orderBy: { createdAt: "desc" },
    include: { client: true },
  });
  const balanceCents = entries.reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </div>

      <div className="hand-drawn-border bg-card p-6 max-w-sm">
        <p className="font-label text-sm text-muted-foreground">{t("balance")}</p>
        <p className="mt-1 font-display font-bold text-5xl text-primary">{eur(balanceCents)}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="font-label text-sm text-muted-foreground border-b-2 border-border">
              <th className="py-2 pr-4">{t("date")}</th>
              <th className="py-2 pr-4">{t("note")}</th>
              <th className="py-2 pr-4">{t("client")}</th>
              <th className="py-2 text-right">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/60">
                <td className="py-3 pr-4 font-mono text-xs whitespace-nowrap">
                  {shortDate(e.createdAt)}
                </td>
                <td className="py-3 pr-4">{e.note}</td>
                <td className="py-3 pr-4 font-label text-sm text-muted-foreground">
                  {e.client?.restaurantName ?? "—"}
                </td>
                <td
                  className={`py-3 text-right font-mono whitespace-nowrap ${
                    e.amountCents < 0 ? "text-destructive" : ""
                  }`}
                >
                  {eur(e.amountCents)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 font-hand text-2xl text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
