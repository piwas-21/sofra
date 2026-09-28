import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryPublishedPage } from "../../lib/catalogue/list-query";
import { queryCurrentBatch } from "../../lib/catalogue/current-batch";
import { syncManifest } from "../../scripts/catalogue/sync-manifests.mjs";
import {
  catalogueLocales,
  parseManifest,
  publicationBlockers,
} from "../../scripts/catalogue/manifest-contract.mjs";
import { validateCatalogue } from "../../scripts/catalogue/validate-manifests.mjs";

const databaseUrl = process.env.CATALOGUE_TEST_DATABASE_URL;
if (process.env.REQUIRE_CATALOGUE_TEST_DATABASE_URL === "1" && !databaseUrl) {
  throw new Error("CATALOGUE_TEST_DATABASE_URL is required for the catalogue database regression.");
}

const catalogueDbDescribe = databaseUrl ? describe : describe.skip;

catalogueDbDescribe("catalogue publish workflow (disposable PostgreSQL)", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("CATALOGUE_TEST_DATABASE_URL is required.");
    const target = new URL(databaseUrl);
    const databaseName = decodeURIComponent(target.pathname.slice(1));
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname)
      || databaseName !== "sofra_catalogue_test") {
      throw new Error("catalogue publisher regression only runs against local sofra_catalogue_test.");
    }
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const schema = await pool.query("SELECT to_regclass('catalogue.revision') IS NOT NULL AS ready");
    if (!schema.rows[0]?.ready) {
      throw new Error("run the catalogue migration against sofra_catalogue_test before this regression.");
    }
    const access = await pool.query(
      [
        "SELECT",
        "has_table_privilege('sofra_catalogue_reader', 'catalogue.public_current_status', 'SELECT') AS current_status,",
        "has_table_privilege('sofra_catalogue_reader', 'catalogue.public_revision_status', 'SELECT') AS revision_status,",
        "has_table_privilege('sofra_catalogue_reader', 'catalogue.revision_event', 'SELECT') AS raw_events",
      ].join(" "),
    );
    expect(access.rows[0]).toEqual({
      current_status: true,
      revision_status: true,
      raw_events: false,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("keeps a draft source-only, then publishes its reviewed content as an immutable revision", async () => {
    const templateId = "test-" + randomUUID().replaceAll("-", "");
    const sourceLocale = "en";
    const parsedDraft = parseManifest({
      schemaVersion: 1,
      templateId,
      revision: 1,
      type: "category",
      cuisines: ["test"],
      sourceLocale,
      name: "Test category",
      translations: {},
      localeFallbacks: [],
      dependencies: [],
      provenance: {
        contentOrigin: "sofra-original",
        sourceDescription: "Disposable integration fixture",
        license: "Sofra original",
        mediaAssets: [],
      },
      qualityStatus: "draft",
      publicationStatus: "unpublished",
      compatibleTenantContractVersions: [1],
      operatorReview: { status: "pending", evidenceRef: null },
      payload: { sortOrder: 0 },
    });
    expect(parsedDraft.success).toBe(true);
    if (!parsedDraft.success) throw new Error("integration fixture does not match the catalogue schema");
    const draft = parsedDraft.data;
    expect(validateCatalogue([{ file: "publisher-test.json", manifest: draft }])).toEqual([]);

    await expect(syncManifest(pool, draft)).resolves.toBe("source-only draft; not stored in the catalogue database");
    const beforeReview = await pool.query(
      "SELECT count(*)::integer AS count FROM catalogue.revision WHERE template_id = $1",
      [templateId],
    );
    expect(beforeReview.rows[0]?.count).toBe(0);
    const draftStatus = await pool.query(
      "SELECT 1 FROM catalogue.public_current_status WHERE template_id = $1",
      [templateId],
    );
    expect(draftStatus.rows).toHaveLength(0);
    expect(await queryCurrentBatch(pool, [{ templateId, adoptedRevision: 1 }])).toMatchObject([
      { templateId, status: "notFound", revision: null },
    ]);

    const translations = Object.fromEntries(
      catalogueLocales
        .filter((locale) => locale !== sourceLocale)
        .map((locale) => [locale, { name: "Reviewed test category" }]),
    );
    const reviewed = {
      ...draft,
      translations,
      qualityStatus: "reviewed" as const,
      publicationStatus: "published" as const,
      operatorReview: { status: "approved" as const, evidenceRef: "disposable-test-review" },
    };
    expect(publicationBlockers(reviewed).blockers).toEqual([]);
    expect(validateCatalogue([{ file: "publisher-test.json", manifest: reviewed }])).toEqual([]);

    await expect(syncManifest(pool, reviewed)).resolves.toBe("published");
    const published = await pool.query(
      [
        "SELECT revision, quality_status::text AS quality_status, content_hash",
        "FROM catalogue.public_current WHERE template_id = $1",
      ].join(" "),
      [templateId],
    );
    expect(published.rows).toHaveLength(1);
    expect(published.rows[0]).toMatchObject({ revision: 1, quality_status: "reviewed" });
    expect(published.rows[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/);

    await expect(pool.query(
      "UPDATE catalogue.revision SET name = 'mutated' WHERE template_id = $1 AND revision = 1",
      [templateId],
    )).rejects.toThrow("catalogue content is immutable");
    await expect(syncManifest(pool, reviewed)).resolves.toBe("published");

    const secondTemplateId = templateId + "-second";
    const secondReviewed = { ...reviewed, templateId: secondTemplateId };
    expect(validateCatalogue([{ file: "publisher-test-second.json", manifest: secondReviewed }])).toEqual([]);
    await expect(syncManifest(pool, secondReviewed)).resolves.toBe("published");
    const beforeWithdrawal = await queryCurrentBatch(pool, [
      { templateId, adoptedRevision: 1 },
      { templateId: secondTemplateId, adoptedRevision: 1 },
    ]);
    expect(beforeWithdrawal.map((item) => item.status)).toEqual(["available", "available"]);
    expect(beforeWithdrawal[0]?.revision).toMatchObject({
      templateId,
      revision: 1,
      qualityStatus: "reviewed",
    });

    const filters = {
      type: "category" as const,
      cuisine: "test",
      q: "Reviewed test category",
      locale: "fr" as const,
      limit: 1,
    };
    const firstPage = await queryPublishedPage(pool, filters);
    expect(firstPage.map((row) => row.template_id)).toEqual([templateId, secondTemplateId]);
    const prefixMatches = await queryPublishedPage(pool, { ...filters, q: "rev te" });
    expect(prefixMatches.map((row) => row.template_id)).toEqual([templateId, secondTemplateId]);
    const nextPage = await queryPublishedPage(pool, filters, firstPage[0]?.template_id);
    expect(nextPage.map((row) => row.template_id)).toEqual([secondTemplateId]);

    const unmatchedCuisine = await queryPublishedPage(pool, { ...filters, cuisine: "not-test" });
    expect(unmatchedCuisine).toEqual([]);

    const eventCount = await pool.query(
      "SELECT count(*)::integer AS count FROM catalogue.revision_event WHERE template_id = $1",
      [templateId],
    );
    expect(eventCount.rows[0]?.count).toBe(1);

    await pool.query(
      "INSERT INTO catalogue.revision_event (template_id, revision, event_type) VALUES ($1, 1, 'WITHDRAWN')",
      [templateId],
    );
    const withdrawnRevision = await pool.query(
      "SELECT revision, withdrawn FROM catalogue.public_revision_status WHERE template_id = $1",
      [templateId],
    );
    expect(withdrawnRevision.rows).toEqual([{ revision: 1, withdrawn: true }]);
    const withdrawnTemplate = await pool.query(
      "SELECT revision, content_hash, withdrawn FROM catalogue.public_current_status WHERE template_id = $1",
      [templateId],
    );
    expect(withdrawnTemplate.rows).toMatchObject([{
      revision: null,
      content_hash: null,
      withdrawn: true,
    }]);
    const stillPublished = await pool.query(
      "SELECT withdrawn FROM catalogue.public_current_status WHERE template_id = $1",
      [secondTemplateId],
    );
    expect(stillPublished.rows).toEqual([{ withdrawn: false }]);
    const afterWithdrawal = await queryCurrentBatch(pool, [
      { templateId, adoptedRevision: 1 },
      { templateId: secondTemplateId, adoptedRevision: 1 },
      { templateId: "never-published-batch", adoptedRevision: 1 },
    ]);
    expect(afterWithdrawal).toMatchObject([
      { templateId, status: "withdrawn", revision: null, adoptedRevisionWithdrawn: true },
      { templateId: secondTemplateId, status: "available", adoptedRevisionWithdrawn: false },
      { templateId: "never-published-batch", status: "notFound", revision: null },
    ]);
  });

  it("requires revisions for publications while allowing withdrawal tombstones", async () => {
    const templateId = "constraint-" + randomUUID().replaceAll("-", "");
    await pool.query(
      "INSERT INTO catalogue.template (template_id, type) VALUES ($1, 'category')",
      [templateId],
    );

    await expect(pool.query(
      "INSERT INTO catalogue.revision_event (template_id, revision, event_type) VALUES ($1, NULL, 'PUBLISHED')",
      [templateId],
    )).rejects.toThrow();
    await expect(pool.query(
      "INSERT INTO catalogue.revision_event (template_id, revision, event_type) VALUES ($1, NULL, 'WITHDRAWN')",
      [templateId],
    )).resolves.toMatchObject({ rowCount: 1 });
    const unpublishedStatus = await pool.query(
      "SELECT 1 FROM catalogue.public_current_status WHERE template_id = $1",
      [templateId],
    );
    expect(unpublishedStatus.rows).toHaveLength(0);
  });
});
