import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  loadCatalogueManifests,
  validateCatalogue,
} from "./validate-manifests.mjs";
import { publicationBlockers } from "./manifest-contract.mjs";

const { Pool } = pg;
export async function syncManifest(db, manifest) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [manifest.templateId]);

    if (manifest.publicationStatus === "withdrawn") {
      const found = await client.query(
        "SELECT content_hash, type::text AS type FROM catalogue.revision WHERE template_id = $1 AND revision = $2",
        [manifest.templateId, manifest.revision],
      );
      const existing = found.rows[0];
      if (!existing || existing.content_hash.trim() !== contentHash(manifest) || existing.type !== manifest.type) {
        throw new Error("withdrawal must reference the exact stored immutable revision");
      }
      await appendEvent(client, manifest.templateId, manifest.revision, "WITHDRAWN", manifest.withdrawScope);
      await client.query("COMMIT");
      return "withdrawal recorded";
    }

    if (manifest.publicationStatus === "unpublished") {
      const found = await client.query(
        [
          "SELECT content_hash, type::text AS type FROM catalogue.revision",
          "WHERE template_id = $1 AND revision = $2",
        ].join(" "),
        [manifest.templateId, manifest.revision],
      );
      const existing = found.rows[0];
      if (!existing) {
        await client.query("COMMIT");
        return "source-only draft; not stored in the catalogue database";
      }
      if (existing.content_hash.trim() !== contentHash(manifest) || existing.type !== manifest.type) {
        throw new Error("an existing immutable revision has different content; increment the revision number");
      }
      const publicRevision = await client.query(
        "SELECT 1 FROM catalogue.public_revision WHERE template_id = $1 AND revision = $2",
        [manifest.templateId, manifest.revision],
      );
      if (publicRevision.rowCount) {
        throw new Error("a published revision cannot be marked unpublished; record an explicit withdrawal");
      }
      await client.query("COMMIT");
      return "unchanged unpublished immutable revision";
    }

    await client.query(
      "INSERT INTO catalogue.template (template_id, type) VALUES ($1, $2::catalogue.template_type) ON CONFLICT (template_id) DO NOTHING",
      [manifest.templateId, manifest.type],
    );
    const storedTemplate = await client.query(
      "SELECT type::text AS type FROM catalogue.template WHERE template_id = $1",
      [manifest.templateId],
    );
    if (storedTemplate.rows[0]?.type !== manifest.type) {
      throw new Error("template type cannot change between revisions");
    }

    const hash = contentHash(manifest);
    const searchText = [
      manifest.name,
      manifest.description ?? "",
      ...Object.values(manifest.translations).flatMap((value) => [value.name, value.description ?? ""]),
    ].join(" ").trim();
    await client.query(
      [
        "INSERT INTO catalogue.revision (template_id, revision, schema_version, type, name, description,",
        "cuisines, source_locale, translations, locale_fallbacks, dependencies, provenance, quality_status,",
        "compatible_tenant_contract_versions, payload, search_text, content_hash)",
        "VALUES ($1, $2, $3, $4::catalogue.template_type, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb,",
        "$12::jsonb, $13::catalogue.quality_status, $14, $15::jsonb, $16, $17)",
        "ON CONFLICT (template_id, revision) DO NOTHING",
      ].join(" "),
      [
        manifest.templateId,
        manifest.revision,
        manifest.schemaVersion,
        manifest.type,
        manifest.name,
        manifest.description ?? null,
        manifest.cuisines,
        manifest.sourceLocale,
        JSON.stringify(manifest.translations),
        manifest.localeFallbacks,
        JSON.stringify(manifest.dependencies),
        JSON.stringify(manifest.provenance),
        manifest.qualityStatus,
        manifest.compatibleTenantContractVersions,
        JSON.stringify(manifest.payload),
        searchText,
        hash,
      ],
    );
    const storedRevision = await client.query(
      "SELECT content_hash, type::text AS type FROM catalogue.revision WHERE template_id = $1 AND revision = $2",
      [manifest.templateId, manifest.revision],
    );
    const existing = storedRevision.rows[0];
    if (!existing || existing.content_hash.trim() !== hash || existing.type !== manifest.type) {
      throw new Error("an existing immutable revision has different content; increment the revision number");
    }

    const blockers = publicationBlockers(manifest).blockers;
    if (manifest.qualityStatus !== "reviewed" || blockers.length) {
      throw new Error("publication is blocked: " + blockers.join("; "));
    }
    for (const dependency of manifest.dependencies) {
      const visible = await client.query(
        "SELECT 1 FROM catalogue.public_revision WHERE template_id = $1 AND revision = $2",
        [dependency.templateId, dependency.revision],
      );
      if (visible.rowCount !== 1) {
        throw new Error("publication dependency is not currently published: "
          + dependency.templateId + "@" + dependency.revision);
      }
    }
    await appendEvent(client, manifest.templateId, manifest.revision, "PUBLISHED");
    await client.query("COMMIT");
    return "published";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const connectionString = process.env.CATALOGUE_DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("CATALOGUE_DATABASE_URL must point to the catalogue migration owner connection.");
    process.exitCode = 2;
    return;
  }

  const loaded = await loadCatalogueManifests();
  const errors = validateCatalogue(loaded.manifests, loaded.errors);
  if (errors.length) {
    for (const error of errors) console.error("ERROR: " + error);
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: "sofra-catalogue-manifest-sync",
  });
  try {
    for (const { manifest } of dependencyOrder(loaded.manifests)) {
      const result = await syncManifest(pool, manifest);
      console.log(manifest.templateId + "@" + manifest.revision + ": " + result);
    }
    console.log("Catalogue sync complete. Drafts stay in source; published revisions and events are append-only.");
  } catch (error) {
    console.error("Catalogue manifest sync failed: " + safeErrorName(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function appendEvent(client, templateId, revision, eventType, withdrawScope) {
  const templateScope = eventType === "WITHDRAWN" && withdrawScope === "template";
  const storedRevision = templateScope ? null : revision;
  const latest = await client.query(
    [
      "SELECT event_type::text AS event_type FROM catalogue.revision_event",
      "WHERE template_id = $1 AND revision IS NOT DISTINCT FROM $2::integer",
      "ORDER BY event_id DESC LIMIT 1",
    ].join(" "),
    [templateId, storedRevision],
  );
  if (latest.rows[0]?.event_type === eventType) return;
  await client.query(
    "INSERT INTO catalogue.revision_event (template_id, revision, event_type) VALUES ($1, $2, $3::catalogue.revision_event_type)",
    [templateId, storedRevision, eventType],
  );
}

function contentHash(manifest) {
  const immutableContent = { ...manifest };
  delete immutableContent.publicationStatus;
  delete immutableContent.withdrawScope;
  return createHash("sha256").update(canonicalJson(immutableContent)).digest("hex");
}

function dependencyOrder(entries) {
  const byVersion = new Map(entries.map(({ manifest, file }) => [
    manifest.templateId + "@" + manifest.revision,
    { manifest, file },
  ]));
  const active = new Set();
  const done = new Set();
  const ordered = [];
  const visit = (entry) => {
    const key = entry.manifest.templateId + "@" + entry.manifest.revision;
    if (done.has(key)) return;
    if (active.has(key)) throw new Error("dependency cycle includes " + key);
    active.add(key);
    for (const dependency of entry.manifest.dependencies) {
      const child = byVersion.get(dependency.templateId + "@" + dependency.revision);
      if (child) visit(child);
    }
    active.delete(key);
    done.add(key);
    ordered.push(entry);
  };
  for (const entry of entries) visit(entry);
  return ordered;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => JSON.stringify(key) + ":" + canonicalJson(child));
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value);
}

function safeErrorName(error) {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code).slice(0, 32)
    : "";
  const name = error instanceof Error ? error.name : "UnknownError";
  return code ? name + " (database code " + code + ")" : name;
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) await main();
