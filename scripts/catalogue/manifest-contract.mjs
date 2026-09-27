import { z } from "zod";

export const catalogueLocales = ["en", "fr", "de", "nl", "tr", "ar", "es", "it", "ru", "zh"];
export const templateTypes = ["ingredient", "option-set", "item", "bundle", "category", "cuisine-pack"];
const locale = z.enum(catalogueLocales);
const templateId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const reference = z.object({
  templateId,
  revision: z.number().int().positive().max(2_147_483_647),
}).strict();
const reviewFields = z.array(z.enum([
  "price",
  "ingredients",
  "allergens",
  "availability",
  "channels",
  "kitchen-routing",
  "images",
])).max(12);
const optionReference = reference.extend({
  sortOrder: z.number().int().nonnegative(),
  default: z.boolean().optional(),
});
const bundleSection = z.object({
  sectionKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48),
  name: z.string().min(1).max(120),
  translations: z.partialRecord(locale, z.object({
    name: z.string().trim().min(1).max(120),
  }).strict()).optional(),
  sortOrder: z.number().int().nonnegative(),
  min: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  options: z.array(optionReference).min(1),
}).strict();

const payloadSchemas = {
  ingredient: z.object({ suggestedOnly: z.literal(true), role: z.string().min(1).max(80) }).strict(),
  "option-set": z.object({
    kind: z.enum(["sauce", "ingredient", "bundle-option", "suggested-side"]),
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    options: z.array(optionReference).min(1),
  }).strict(),
  item: z.object({
    category: reference.optional(),
    suggestedIngredients: z.array(reference),
    optionSets: z.array(reference),
    sideSets: z.array(reference),
    requiredLocalReviewFields: reviewFields,
  }).strict(),
  bundle: z.object({
    standaloneOffer: reference.optional(),
    offerFamily: reference.optional(),
    sections: z.array(bundleSection).min(1),
    requiredLocalReviewFields: reviewFields,
  }).strict(),
  category: z.object({ sortOrder: z.number().int().nonnegative() }).strict(),
  "cuisine-pack": z.object({
    categories: z.array(reference.extend({ sortOrder: z.number().int().nonnegative() })),
    offers: z.array(reference.extend({
      sortOrder: z.number().int().nonnegative(),
      includedByDefault: z.boolean(),
    })).min(1),
    requiredLocalReviewFields: reviewFields,
  }).strict(),
};

export const manifestSchema = z.object({
  schemaVersion: z.number().int().positive().max(2_147_483_647),
  templateId,
  revision: z.number().int().positive().max(2_147_483_647),
  type: z.enum(templateTypes),
  cuisines: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1),
  sourceLocale: locale,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  translations: z.partialRecord(locale, z.object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
  }).strict()),
  localeFallbacks: z.array(locale),
  dependencies: z.array(reference.extend({
    role: z.enum(["category", "offer", "ingredient", "option-set", "side-set", "bundle-option", "offer-family"]),
    sortOrder: z.number().int().nonnegative().optional(),
    includedByDefault: z.boolean().optional(),
  }).strict()),
  provenance: z.object({
    contentOrigin: z.enum(["sofra-original", "external-licensed", "public-domain"]),
    sourceDescription: z.string().trim().min(1).max(300),
    license: z.string().trim().min(1).max(120),
    attribution: z.string().trim().max(300).optional(),
    evidenceRef: z.string().trim().min(1).max(200).optional(),
    mediaAssets: z.array(z.object({
      assetPath: z.string().regex(/^\/catalogue-assets\/[a-z0-9/_-]+\.(png|jpg|jpeg|webp)$/i),
      license: z.string().trim().min(1).max(120),
      evidenceRef: z.string().trim().min(1).max(200),
    }).strict()),
  }).strict(),
  qualityStatus: z.enum(["draft", "reviewed"]),
  publicationStatus: z.enum(["unpublished", "published", "withdrawn"]),
  withdrawScope: z.enum(["revision", "template"]).optional(),
  compatibleTenantContractVersions: z.array(z.number().int().positive()).min(1),
  operatorReview: z.object({
    status: z.enum(["pending", "approved"]),
    evidenceRef: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  payload: z.unknown(),
}).strict();

export function parseManifest(value) {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) return { success: false, issues: parsed.error.issues };
  const payload = payloadSchemas[parsed.data.type].safeParse(parsed.data.payload);
  return payload.success
    ? { success: true, data: { ...parsed.data, payload: payload.data } }
    : { success: false, issues: payload.error.issues };
}

export function manifestReferences(manifest) {
  const references = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.templateId === "string" && Number.isInteger(value.revision)) {
      references.push(value.templateId + "@" + value.revision);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(manifest.payload);
  return [...new Set(references)].sort(compareVersionReferences);
}

export function compareVersionReferences(left, right) {
  const [leftTemplateId, leftRevision] = left.split("@");
  const [rightTemplateId, rightRevision] = right.split("@");
  return leftTemplateId.localeCompare(rightTemplateId)
    || Number(leftRevision) - Number(rightRevision);
}

export function publicationBlockers(manifest) {
  const covered = new Set([
    manifest.sourceLocale,
    ...Object.keys(manifest.translations),
    ...manifest.localeFallbacks,
  ]);
  const missingLocales = catalogueLocales.filter((item) => !covered.has(item));
  const blockers = [];
  if (manifest.qualityStatus !== "reviewed") blockers.push("content quality review is incomplete");
  if (manifest.operatorReview.status !== "approved" || !manifest.operatorReview.evidenceRef) {
    blockers.push("restaurant operator review is missing");
  }
  if (manifest.provenance.contentOrigin !== "sofra-original" && !manifest.provenance.evidenceRef) {
    blockers.push("content rights evidence is missing");
  }
  if (manifest.provenance.contentOrigin === "external-licensed" && !manifest.provenance.attribution) {
    blockers.push("external content attribution is missing");
  }
  if (missingLocales.length) blockers.push("locale coverage is missing: " + missingLocales.join(", "));
  if (manifest.type === "bundle" && manifest.payload.offerFamily) {
    blockers.push("offer-family template import contract is not defined");
  }
  return { blockers, missingLocales, coveredLocaleCount: covered.size };
}

export function findUnsafeContent(manifest) {
  const errors = [];
  const forbiddenKey = /^(tenant|restaurant|customer|order|localProduct|localIngredient|operational)(Id|Slug|Name|Url)?$/i;
  const forbiddenFact = /(price|currency|surcharge|allergen|recipe|portion|nutrition|dietary|halal|gluten.?free)/i;
  const visit = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, path + "[" + index + "]"));
      return;
    }
    if (typeof value === "string") {
      if (/https?:\/\//i.test(value) && !path.endsWith(".evidenceRef")) {
        errors.push(path + " contains a remote URL outside its rights evidence field");
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) errors.push(path + "." + key + " looks like tenant or operational data");
      if (forbiddenFact.test(key)) errors.push(path + "." + key + " contains a tenant-confirmed fact field");
      visit(child, path + "." + key);
    }
  };
  visit(manifest, manifest.templateId);
  return errors;
}

export function validateCardinality(manifest) {
  const errors = [];
  const checkOptions = (path, min, max, options) => {
    const refs = options.map((option) => option.templateId + "@" + option.revision);
    if (new Set(refs).size !== refs.length) errors.push(path + " has duplicate option references");
    if (min > max || max > new Set(refs).size) errors.push(path + " has invalid min/max cardinality");
    const defaults = options.filter((option) => option.default).length;
    if (defaults && (defaults < min || defaults > max)) errors.push(path + " has defaults outside min/max");
  };
  if (manifest.type === "option-set") {
    checkOptions(manifest.templateId, manifest.payload.min, manifest.payload.max, manifest.payload.options);
    if (manifest.payload.kind === "ingredient" &&
      (manifest.payload.min !== 0 || manifest.payload.max !== manifest.payload.options.length)) {
      errors.push(manifest.templateId + " ingredient exclusions must remain optional and unrestricted");
    }
  }
  if (manifest.type === "bundle") {
    manifest.payload.sections.forEach((section) =>
      checkOptions(manifest.templateId + "." + section.sectionKey, section.min, section.max, section.options));
  }
  return errors;
}
