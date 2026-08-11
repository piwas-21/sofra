import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur } from "@/lib/format";
import { clampQuarter, quarterRange, toIcpLines } from "@/lib/icp";

export const dynamic = "force-dynamic";

/**
 * The quarterly EC Sales List (opgaaf ICP) — B7.
 *
 * Reads `taxTreatment = EU_REVERSE_CHARGE` from the invoices, which is what makes
 * this a query rather than a reconstruction: the treatment was decided and stored
 * when the sale happened, so a customer whose VAT status has changed since does
 * not silently rewrite a past quarter.
 */
export default async function AdminIcpPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ y?: string; q?: string }> }>) {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.icp" });

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.y) || now.getUTCFullYear();
  const quarter = clampQuarter(Number(sp.q) || Math.floor(now.getUTCMonth() / 3) + 1);
  const { from, to } = quarterRange(year, quarter);

  const invoices = await db.invoice.findMany({
    where: { taxTreatment: "EU_REVERSE_CHARGE", issuedAt: { gte: from, lt: to } },
    select: { buyerSnapshot: true, netCents: true },
  });
  const lines = toIcpLines(invoices);
  const total = lines.reduce((sum, l) => sum + l.netCents, 0);
  // An invoice that reached this list without a VAT number on it is a
  // contradiction — reverse charge requires one. Surfaced rather than dropped.
  const listed = lines.reduce((sum, l) => sum + l.invoiceCount, 0);
  const missing = invoices.length - listed;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
      </div>

      <form className="flex flex-wrap items-end gap-3 font-label text-sm">
        <label className="grid gap-1">
          {t("year")}
          <input name="y" type="number" defaultValue={year} className="input-primary w-28" />
        </label>
        <label className="grid gap-1">
          {t("quarter")}
          <select name="q" defaultValue={quarter} className="input-primary w-24">
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-secondary">
          {t("show")}
        </button>
        <a href={`/api/admin/icp?y=${year}&q=${quarter}`} className="btn-primary" download>
          {t("download")}
        </a>
      </form>

      {missing > 0 && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("missingVat", { count: missing })}
        </p>
      )}

      <table className="w-full font-label text-sm">
        <thead>
          <tr className="border-b-2 border-border text-left">
            <th className="py-2">{t("country")}</th>
            <th className="py-2">{t("vatNumber")}</th>
            <th className="py-2 text-right">{t("invoices")}</th>
            <th className="py-2 text-right">{t("net")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.vatNumber} className="border-b border-border">
              <td className="py-2">{l.countryCode}</td>
              <td className="py-2 font-mono">{l.vatNumber}</td>
              <td className="py-2 text-right">{l.invoiceCount}</td>
              <td className="py-2 text-right">{eur(l.netCents)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-muted-foreground">
                {t("empty")}
              </td>
            </tr>
          )}
        </tbody>
        {lines.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              <td className="py-2" colSpan={3}>
                {t("total")}
              </td>
              <td className="py-2 text-right">{eur(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
