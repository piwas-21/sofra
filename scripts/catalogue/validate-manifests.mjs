import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUnsafeContent,
  manifestReferences,
  parseManifest,
  publicationBlockers,
  validateCardinality,
} from "./manifest-contract.mjs";

const manifestRoot = join(dirname(fileURLToPath(import.meta.url)), "../../catalogue/manifests");

export async function loadCatalogueManifests() {
  const files = (await readdir(manifestRoot)).filter((file) => file.endsWith(".json")).sort();
  const manifests = [];
  const errors = [];
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(join(manifestRoot, file), "utf8"));
      const parsed = parseManifest(value);
      if (!parsed.success) {
        errors.push(file + ": invalid manifest shape (" + parsed.issues.length + " issue(s))");
      } else {
        manifests.push({ file, manifest: parsed.data });
        for (const asset of parsed.data.provenance.mediaAssets) {
          const assetPath = join(manifestRoot, "../../public", asset.assetPath.slice(1));
          try {
            await access(assetPath);
          } catch {
            errors.push(file + ": licensed local media asset is missing: " + asset.assetPath);
          }
        }
      }
    } catch {
      errors.push(file + ": invalid JSON or unreadable file");
    }
  }
  return { manifests, errors };
}

export function validateCatalogue(manifests, errors = []) {
  const byVersion = new Map();
  const allErrors = [...errors];
  for (const entry of manifests) {
    const { file, manifest } = entry;
    const versionKey = manifest.templateId + "@" + manifest.revision;
    if (byVersion.has(versionKey)) allErrors.push(file + ": duplicate revision " + versionKey);
    byVersion.set(versionKey, entry);
    if (new Set(manifest.cuisines).size !== manifest.cuisines.length) {
      allErrors.push(file + ": duplicate cuisine tags");
    }
    if (new Set(manifest.localeFallbacks).size !== manifest.localeFallbacks.length) {
      allErrors.push(file + ": duplicate locale fallback");
    }
    if (manifest.localeFallbacks.includes(manifest.sourceLocale)) {
      allErrors.push(file + ": source locale cannot be listed as a fallback");
    }
    const translated = Object.keys(manifest.translations);
    if (translated.some((item) => item === manifest.sourceLocale)) {
      allErrors.push(file + ": source locale belongs in the canonical name, not translations");
    }
    for (const error of findUnsafeContent(manifest)) allErrors.push(file + ": " + error);
    for (const error of validateCardinality(manifest)) allErrors.push(file + ": " + error);
    const declared = manifest.dependencies
      .map((item) => item.templateId + "@" + item.revision)
      .sort();
    const referenced = manifestReferences(manifest);
    const expectedRoles = expectedDependencyRoles(manifest);
    if (new Set(declared).size !== declared.length) allErrors.push(file + ": duplicate dependency reference");
    if (JSON.stringify(declared) !== JSON.stringify(referenced)) {
      allErrors.push(file + ": dependencies do not exactly match payload references");
    }
    for (const dependency of manifest.dependencies) {
      const key = dependency.templateId + "@" + dependency.revision;
      const expectedRole = expectedRoles.get(key);
      if (expectedRole === "duplicate") {
        allErrors.push(file + ": one template revision is referenced in multiple payload roles");
      } else if (expectedRole !== dependency.role) {
        allErrors.push(file + ": dependency role does not match its payload reference for " + key);
      }
      if (dependency.templateId === manifest.templateId && dependency.revision === manifest.revision) {
        allErrors.push(file + ": template cannot depend on itself");
      }
    }
    if (manifest.type === "cuisine-pack") {
      for (const category of manifest.payload.categories) {
        const dependency = manifest.dependencies.find((item) =>
          item.templateId === category.templateId && item.revision === category.revision);
        if (dependency?.sortOrder !== category.sortOrder) {
          allErrors.push(file + ": category dependency sort order differs from pack payload");
        }
      }
      for (const offer of manifest.payload.offers) {
        const dependency = manifest.dependencies.find((item) =>
          item.templateId === offer.templateId && item.revision === offer.revision);
        if (dependency?.sortOrder !== offer.sortOrder
          || dependency?.includedByDefault !== offer.includedByDefault) {
          allErrors.push(file + ": offer dependency defaults differ from pack payload");
        }
      }
    }
    if (manifest.publicationStatus === "published" && publicationBlockers(manifest).blockers.length) {
      allErrors.push(file + ": published revision is blocked: " + publicationBlockers(manifest).blockers.join("; "));
    }
    if (manifest.qualityStatus === "reviewed" && publicationBlockers(manifest).blockers.length) {
      allErrors.push(file + ": reviewed status is blocked: " + publicationBlockers(manifest).blockers.join("; "));
    }
    if (manifest.publicationStatus === "withdrawn" && !manifest.withdrawScope) {
      allErrors.push(file + ": withdrawn revision must declare its withdrawal scope");
    }
  }

  for (const entry of manifests) {
    for (const dependency of entry.manifest.dependencies) {
      const target = byVersion.get(dependency.templateId + "@" + dependency.revision);
      if (!target) {
        allErrors.push(entry.file + ": missing dependency " + dependency.templateId + "@" + dependency.revision);
      } else if (!roleMatchesType(dependency.role, target.manifest.type)) {
        allErrors.push(
          entry.file + ": dependency role " + dependency.role + " does not match "
          + target.manifest.type + " template " + dependency.templateId + "@" + dependency.revision,
        );
      }
      if (target && entry.manifest.publicationStatus === "published"
        && target.manifest.publicationStatus !== "published") {
        allErrors.push(entry.file + ": published revision depends on an unpublished or withdrawn revision");
      }
    }
  }
  allErrors.push(...cycleErrors(manifests));
  return allErrors;
}

function roleMatchesType(role, type) {
  const allowedTypes = {
    category: ["category"],
    offer: ["item", "bundle"],
    ingredient: ["ingredient"],
    "option-set": ["option-set"],
    "side-set": ["option-set"],
    "bundle-option": ["item", "bundle"],
    "offer-family": ["bundle"],
  };
  return allowedTypes[role]?.includes(type) ?? false;
}

function expectedDependencyRoles(manifest) {
  const expected = new Map();
  const add = (reference, role) => {
    const key = reference.templateId + "@" + reference.revision;
    if (expected.has(key)) expected.set(key, "duplicate");
    else expected.set(key, role);
  };
  if (manifest.type === "item") {
    if (manifest.payload.category) add(manifest.payload.category, "category");
    manifest.payload.suggestedIngredients.forEach((item) => add(item, "ingredient"));
    manifest.payload.optionSets.forEach((item) => add(item, "option-set"));
    manifest.payload.sideSets.forEach((item) => add(item, "side-set"));
  }
  if (manifest.type === "option-set") {
    const role = manifest.payload.kind === "ingredient" || manifest.payload.kind === "sauce"
      ? "ingredient"
      : "bundle-option";
    manifest.payload.options.forEach((item) => add(item, role));
  }
  if (manifest.type === "bundle") {
    manifest.payload.sections.forEach((section) => section.options.forEach((item) => add(item, "bundle-option")));
    if (manifest.payload.standaloneOffer) add(manifest.payload.standaloneOffer, "offer");
    if (manifest.payload.offerFamily) add(manifest.payload.offerFamily, "offer-family");
  }
  if (manifest.type === "cuisine-pack") {
    manifest.payload.categories.forEach((item) => add(item, "category"));
    manifest.payload.offers.forEach((item) => add(item, "offer"));
  }
  return expected;
}

function cycleErrors(manifests) {
  const graph = new Map(manifests.map(({ manifest }) => [
    manifest.templateId + "@" + manifest.revision,
    manifest.dependencies.map((item) => item.templateId + "@" + item.revision),
  ]));
  const active = new Set();
  const done = new Set();
  const errors = [];
  const visit = (node) => {
    if (active.has(node)) {
      errors.push("dependency cycle includes " + node);
      return;
    }
    if (done.has(node)) return;
    active.add(node);
    for (const child of graph.get(node) ?? []) visit(child);
    active.delete(node);
    done.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return [...new Set(errors)];
}

function printReport(manifests) {
  const published = manifests.filter(({ manifest }) => manifest.publicationStatus === "published").length;
  console.log("Catalogue manifest revisions: " + manifests.length);
  console.log("Published: " + published + "; unpublished or withdrawn: " + (manifests.length - published));
  for (const { manifest } of manifests) {
    const review = publicationBlockers(manifest);
    const status = manifest.publicationStatus.toUpperCase();
    console.log(
      manifest.templateId + "@" + manifest.revision + ": " + status
      + "; locale coverage " + review.coveredLocaleCount + "/10"
      + (review.missingLocales.length ? " (missing " + review.missingLocales.join(", ") + ")" : ""),
    );
    if (review.blockers.length) console.log("  Publication held: " + review.blockers.join("; "));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const loaded = await loadCatalogueManifests();
  const errors = validateCatalogue(loaded.manifests, loaded.errors);
  printReport(loaded.manifests);
  if (errors.length) {
    for (const error of errors) console.error("ERROR: " + error);
    process.exitCode = 1;
  }
}
