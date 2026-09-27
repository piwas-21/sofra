export const CATALOGUE_TEMPLATE_TYPES = [
  "ingredient",
  "option-set",
  "item",
  "bundle",
  "category",
  "cuisine-pack",
] as const;

export type CatalogueTemplateType = (typeof CATALOGUE_TEMPLATE_TYPES)[number];
export type CatalogueTranslation = { name: string; description?: string };
export type CatalogueTranslations = Record<string, CatalogueTranslation>;

export type CatalogueDependency = {
  templateId: string;
  revision: number;
  role: string;
  sortOrder?: number;
  includedByDefault?: boolean;
};

export type TemplateRevisionResponse = {
  schemaVersion: number;
  templateId: string;
  revision: number;
  type: CatalogueTemplateType;
  cuisines: string[];
  name: string;
  description: string | null;
  sourceLocale: string;
  translations: CatalogueTranslations;
  localeFallbacks: string[];
  dependencies: CatalogueDependency[];
  provenance: Record<string, unknown>;
  qualityStatus: "reviewed";
  compatibleTenantContractVersions: number[];
  payload: Record<string, unknown>;
  contentHash: string;
};

export type TemplateSummary = {
  templateId: string;
  revision: number;
  type: CatalogueTemplateType;
  cuisines: string[];
  displayName: string;
  sourceLocale: string;
  displayLocale: string;
  usedSourceFallback: boolean;
  reviewedTranslationLocales: string[];
  dependencyCount: number;
  compatibleTenantContractVersions: number[];
};

export type TemplatePage = { items: TemplateSummary[]; nextCursor: string | null };
