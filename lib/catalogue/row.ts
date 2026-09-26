import type { QueryResultRow } from "pg";
import type {
  CatalogueDependency,
  CatalogueTemplateType,
  CatalogueTranslations,
  TemplateRevisionResponse,
  TemplateSummary,
} from "@/lib/catalogue/types";

export type PublishedRevisionRow = QueryResultRow & {
  template_id: string;
  revision: number;
  schema_version: number;
  type: CatalogueTemplateType;
  name: string;
  description: string | null;
  cuisines: string[];
  source_locale: string;
  translations: CatalogueTranslations;
  locale_fallbacks: string[];
  dependencies: CatalogueDependency[];
  provenance: Record<string, unknown>;
  quality_status: string;
  compatible_tenant_contract_versions: number[];
  payload: Record<string, unknown>;
  content_hash: string;
};

export function toRevision(row: PublishedRevisionRow): TemplateRevisionResponse {
  return {
    schemaVersion: row.schema_version,
    templateId: row.template_id,
    revision: row.revision,
    type: row.type,
    cuisines: row.cuisines,
    name: row.name,
    description: row.description,
    sourceLocale: row.source_locale,
    translations: row.translations,
    localeFallbacks: row.locale_fallbacks,
    dependencies: row.dependencies,
    provenance: row.provenance,
    qualityStatus: "reviewed",
    compatibleTenantContractVersions: row.compatible_tenant_contract_versions,
    payload: row.payload,
    contentHash: row.content_hash,
  };
}

export function toSummary(row: PublishedRevisionRow, locale?: string): TemplateSummary {
  const translation = locale ? row.translations[locale] : undefined;
  const displayLocale = translation && locale ? locale : row.source_locale;
  return {
    templateId: row.template_id,
    revision: row.revision,
    type: row.type,
    cuisines: row.cuisines,
    displayName: translation?.name ?? row.name,
    sourceLocale: row.source_locale,
    displayLocale,
    usedSourceFallback: Boolean(locale && locale !== row.source_locale && !translation),
    reviewedTranslationLocales: [row.source_locale, ...Object.keys(row.translations)]
      .sort((left, right) => left.localeCompare(right)),
    dependencyCount: row.dependencies.length,
    compatibleTenantContractVersions: row.compatible_tenant_contract_versions,
  };
}
