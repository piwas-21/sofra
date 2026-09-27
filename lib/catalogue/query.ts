import { createHash } from "node:crypto";
import { z } from "zod";
import { CATALOGUE_TEMPLATE_TYPES } from "./types";

export const CATALOGUE_LOCALES = ["en", "fr", "de", "nl", "tr", "ar", "es", "it", "ru", "zh"] as const;
export const CATALOGUE_TEMPLATE_ID_MAX_LENGTH = 120;
export const CATALOGUE_REVISION_MAX = 2_147_483_647;
const filtersSchema = z.object({
  type: z.enum(CATALOGUE_TEMPLATE_TYPES).optional(),
  cuisine: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  locale: z.enum(CATALOGUE_LOCALES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export type CatalogueFilters = z.infer<typeof filtersSchema>;

export function parseCatalogueFilters(params: URLSearchParams):
  | { success: true; filters: CatalogueFilters }
  | { success: false } {
  const allowedKeys = new Set(["type", "cuisine", "q", "locale", "limit", "cursor"]);
  const seenKeys = new Set<string>();
  for (const [key] of params) {
    if (!allowedKeys.has(key) || seenKeys.has(key)) return { success: false };
    seenKeys.add(key);
  }

  const parsed = filtersSchema.safeParse({
    type: params.get("type") || undefined,
    cuisine: params.get("cuisine")?.trim().toLowerCase() || undefined,
    q: params.get("q") || undefined,
    locale: params.get("locale")?.trim().toLowerCase() || undefined,
    limit: params.get("limit") || undefined,
  });
  return parsed.success ? { success: true, filters: parsed.data } : { success: false };
}

function filtersHash(filters: CatalogueFilters): string {
  const stable = JSON.stringify({
    type: filters.type ?? null,
    cuisine: filters.cuisine ?? null,
    q: filters.q?.toLocaleLowerCase() ?? null,
    locale: filters.locale ?? null,
  });
  return createHash("sha256").update(stable).digest("base64url").slice(0, 16);
}

export function encodeCatalogueCursor(templateId: string, filters: CatalogueFilters): string {
  return Buffer.from(JSON.stringify({ templateId, filterHash: filtersHash(filters) })).toString("base64url");
}

const cursorSchema = z.object({
  templateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(CATALOGUE_TEMPLATE_ID_MAX_LENGTH),
  filterHash: z.string().length(16),
});

export function decodeCatalogueCursor(
  cursor: string | null,
  filters: CatalogueFilters,
): { valid: true; templateId?: string } | { valid: false } {
  if (!cursor) return { valid: true };
  if (cursor.length > 512) return { valid: false };
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.filterHash !== filtersHash(filters)) return { valid: false };
    return { valid: true, templateId: parsed.data.templateId };
  } catch {
    return { valid: false };
  }
}
