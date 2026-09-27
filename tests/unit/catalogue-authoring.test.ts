import { describe, expect, it, vi } from "vitest";
import {
  manifestReferences,
  findUnsafeContent,
  publicationBlockers,
} from "../../scripts/catalogue/manifest-contract.mjs";
import {
  loadCatalogueManifests,
  validateCatalogue,
} from "../../scripts/catalogue/validate-manifests.mjs";
import {
  decodeCatalogueCursor,
  encodeCatalogueCursor,
  parseCatalogueFilters,
} from "@/lib/catalogue/query";
import { catalogueRateLimitConfig } from "@/lib/catalogue/config";
import { catalogueRequestLimitResponse } from "@/lib/catalogue/http";
import { queryPublishedPage } from "@/lib/catalogue/list-query";
import type { CatalogueFilters } from "@/lib/catalogue/query";
import type { Pool } from "pg";

describe("central catalogue publication contract", () => {
  it("orders dependency pins by template and numeric revision", () => {
    expect(manifestReferences({ payload: [
      { templateId: "item", revision: 10 },
      { templateId: "category", revision: 1 },
      { templateId: "item", revision: 2 },
    ] })).toEqual(["category@1", "item@2", "item@10"]);
  });

  it("keeps the starter set unpublished pending operator, editorial, and locale review", async () => {
    const loaded = await loadCatalogueManifests();
    expect(loaded.manifests).toHaveLength(6);
    expect(validateCatalogue(loaded.manifests, loaded.errors)).toEqual([]);
    for (const entry of loaded.manifests) {
      const manifest = entry.manifest;
      if (!manifest) throw new Error("manifest parser returned an empty entry");
      expect(manifest.publicationStatus).toBe("unpublished");
      expect(publicationBlockers(manifest).blockers).toContain("restaurant operator review is missing");
    }
  });

  it("rejects publishing a draft revision before review blockers are cleared", async () => {
    const loaded = await loadCatalogueManifests();
    const [entry] = loaded.manifests;
    if (!entry?.manifest) throw new Error("starter set has no manifest");
    const candidate = {
      ...entry.manifest,
      publicationStatus: "published" as const,
    };
    expect(validateCatalogue([{ ...entry, manifest: candidate }])).toEqual(
      expect.arrayContaining([expect.stringContaining("published revision is blocked")]),
    );
  });

  it("rejects tenant facts and incomplete dependency pins in manifests", async () => {
    const loaded = await loadCatalogueManifests();
    const item = loaded.manifests.find(({ manifest }) => manifest?.type === "item");
    if (!item?.manifest) throw new Error("starter pack has no item template");
    const fact = {
      ...item.manifest,
      payload: { ...(item.manifest.payload as Record<string, unknown>), price: 10 },
    };
    expect(findUnsafeContent(fact)).toEqual(
      expect.arrayContaining([expect.stringContaining("tenant-confirmed fact field")]),
    );
    const pack = loaded.manifests.find(({ manifest }) => manifest?.type === "cuisine-pack");
    if (!pack?.manifest) throw new Error("starter set has no cuisine pack");
    const payload = pack.manifest.payload as Record<string, unknown>;
    const missingRef = {
      ...pack.manifest,
      payload: {
        ...payload,
        offers: [{ templateId: "unknown-offer", revision: 1, sortOrder: 1, includedByDefault: true }],
      },
      dependencies: [{ templateId: "unknown-offer", revision: 1, role: "offer", sortOrder: 1, includedByDefault: true }],
    };
    expect(validateCatalogue([{ ...pack, manifest: missingRef }])).toEqual(
      expect.arrayContaining([expect.stringContaining("missing dependency unknown-offer@1")]),
    );
  });
});

describe("published catalogue pagination", () => {
  it("binds an opaque cursor to its validated filters", () => {
    const parsed = parseCatalogueFilters(new URLSearchParams("type=item&cuisine=turkish&locale=tr&limit=12"));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const cursor = encodeCatalogueCursor("tr-kofte-item", parsed.filters);
    expect(decodeCatalogueCursor(cursor, parsed.filters)).toEqual({ valid: true, templateId: "tr-kofte-item" });

    const changed = parseCatalogueFilters(new URLSearchParams("type=item&cuisine=turkish&locale=tr&limit=12&q=kofte"));
    expect(changed.success).toBe(true);
    if (changed.success) expect(decodeCatalogueCursor(cursor, changed.filters)).toEqual({ valid: false });
  });

  it("rejects invalid filters, malformed cursors, and cursors with oversized IDs", () => {
    expect(parseCatalogueFilters(new URLSearchParams("limit=101")).success).toBe(false);
    expect(parseCatalogueFilters(new URLSearchParams("tenantId=rumi")).success).toBe(false);
    expect(parseCatalogueFilters(new URLSearchParams("type=item&type=bundle")).success).toBe(false);
    const parsed = parseCatalogueFilters(new URLSearchParams());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(decodeCatalogueCursor("not-json", parsed.filters)).toEqual({ valid: false });
    expect(decodeCatalogueCursor("x".repeat(513), parsed.filters)).toEqual({ valid: false });
  });
});

describe("published catalogue SQL", () => {
  it("binds filters and an after-template cursor in stable parameter order", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    const filters: CatalogueFilters = {
      type: "item",
      cuisine: "turkish",
      q: "kofte",
      locale: "tr",
      limit: 12,
    };

    await queryPublishedPage(pool, filters, "tr-kofte-item");

    expect(query).toHaveBeenCalledWith(
      "SELECT template_id, revision, schema_version, type::text, name, description, cuisines, source_locale, translations, locale_fallbacks, dependencies, provenance, quality_status::text, compatible_tenant_contract_versions, payload, content_hash FROM catalogue.public_current WHERE type = $1::catalogue.template_type AND cuisines @> ARRAY[$2]::text[] AND to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', $3) AND (source_locale = $4 OR $4 = ANY(locale_fallbacks) OR translations ? $4) AND template_id > $5 ORDER BY template_id ASC LIMIT $6",
      ["item", "turkish", "kofte", "tr", "tr-kofte-item", 13],
    );
  });

  it("omits the WHERE clause when the first page has no filters or cursor", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await queryPublishedPage(pool, { limit: 24 });

    const [statement, values] = query.mock.calls[0] as [string, number[]];
    expect(statement).not.toContain(" WHERE ");
    expect(statement).toContain("ORDER BY template_id ASC LIMIT $1");
    expect(values).toEqual([25]);
  });
});

describe("catalogue rate-limit configuration", () => {
  const testBaseUrl = process.env.CATALOGUE_TEST_BASE_URL;
  if (!testBaseUrl) throw new Error("CATALOGUE_TEST_BASE_URL must be set in the Vitest environment.");

  it("requires positive integer environment values", () => {
    expect(() => catalogueRateLimitConfig({}))
      .toThrow("CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS must be configured as a positive safe integer.");
    expect(() => catalogueRateLimitConfig({ CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS: "80" }))
      .toThrow("CATALOGUE_READ_RATE_LIMIT_WINDOW_MS must be configured as a positive safe integer.");
    expect(catalogueRateLimitConfig({
      CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS: "80",
      CATALOGUE_READ_RATE_LIMIT_WINDOW_MS: "60000",
    })).toEqual({ maxRequests: 80, windowMs: 60_000 });
  });

  it("returns a generic unavailable response when rate-limit configuration is missing", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = catalogueRequestLimitResponse(
        new Request(new URL("/api/v1/catalogue/templates", testBaseUrl)),
        {},
      );
      expect(response?.status).toBe(503);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rejects invalid environment values instead of silently weakening the limit", () => {
    expect(() => catalogueRateLimitConfig({ CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS: "0" }))
      .toThrow("CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS must be configured as a positive safe integer.");
    expect(() => catalogueRateLimitConfig({
      CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS: "80",
      CATALOGUE_READ_RATE_LIMIT_WINDOW_MS: "15m",
    }))
      .toThrow("CATALOGUE_READ_RATE_LIMIT_WINDOW_MS must be configured as a positive safe integer.");
    expect(() => catalogueRateLimitConfig({
      CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS: "80",
      CATALOGUE_READ_RATE_LIMIT_WINDOW_MS: "9007199254740992",
    }))
      .toThrow("CATALOGUE_READ_RATE_LIMIT_WINDOW_MS must be configured as a positive safe integer.");
  });
});
