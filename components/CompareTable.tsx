import { useTranslations } from "next-intl";
import { COMPARE_ROW_KEYS } from "./compare-gloriafood-data";

/**
 * Machine-liftable comparison table for /compare/gloriafood (AEO plan §2).
 * All cell copy comes from `compare.table.*` messages; row keys live in
 * compare-gloriafood-data.ts next to the sources they were verified against.
 */
export default function CompareTable() {
  const t = useTranslations("compare.table");

  return (
    <div className="mt-10 hand-drawn-border bg-card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="border-b-2 border-border font-label text-base">
            <th scope="col" className="px-4 py-3 text-start w-[22%]">
              {t("feature")}
            </th>
            <th scope="col" className="px-4 py-3 text-start text-primary">
              {t("sofra")}
            </th>
            <th scope="col" className="px-4 py-3 text-start">
              {t("gloriafood")}
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROW_KEYS.map((key) => (
            <tr key={key} className="border-b border-border/60 align-top last:border-b-0">
              <th scope="row" className="px-4 py-4 text-start font-label font-normal">
                {t(`rows.${key}.label`)}
              </th>
              <td className="px-4 py-4 leading-relaxed">{t(`rows.${key}.sofra`)}</td>
              <td className="px-4 py-4 leading-relaxed text-muted-foreground">
                {t(`rows.${key}.gf`)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
