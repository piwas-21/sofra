import { describe, expect, it } from "vitest";
import {
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

describe("central catalogue publication contract", () => {
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
