import type { Pool } from "pg";
import type { CatalogueFilters } from "@/lib/catalogue/query";
import type { PublishedRevisionRow } from "@/lib/catalogue/row";

export async function queryPublishedPage(
  pool: Pool,
  filters: CatalogueFilters,
  afterTemplateId?: string,
): Promise<PublishedRevisionRow[]> {
  const where: string[] = [];
  const values: Array<string | number> = [];
  const bind = (value: string | number) => {
    values.push(value);
    return "$" + values.length;
  };

  if (filters.type) where.push("type = " + bind(filters.type) + "::catalogue.template_type");
  if (filters.cuisine) where.push("cuisines @> ARRAY[" + bind(filters.cuisine) + "]::text[]");
  if (filters.q) {
    const query = bind(filters.q);
    where.push("to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', " + query + ")");
  }
  if (filters.locale) {
    const locale = bind(filters.locale);
    where.push("(source_locale = " + locale + " OR " + locale + " = ANY(locale_fallbacks) OR translations ? " + locale + ")");
  }
  if (afterTemplateId) where.push("template_id > " + bind(afterTemplateId));

  const rowLimit = bind(filters.limit + 1);
  const statement = [
    "SELECT template_id, revision, schema_version, type::text, name, description,",
    "cuisines, source_locale, translations, locale_fallbacks, dependencies,",
    "provenance, quality_status::text, compatible_tenant_contract_versions,",
    "payload, content_hash",
    "FROM catalogue.public_current",
    where.length ? "WHERE " + where.join(" AND ") : "",
    "ORDER BY template_id ASC",
    "LIMIT " + rowLimit,
  ].filter(Boolean).join(" ");

  return (await pool.query<PublishedRevisionRow>(statement, values)).rows;
}
