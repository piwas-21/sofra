// Surgical edits to existing tenant entries for a partner's public credit.
// Keep this line-based: registry.yml is hand-maintained and a YAML round-trip
// would erase comments and reorder unrelated tenant fields.

import { isHttpsUrl, type RenderableBrand } from "@/lib/partner-brand";
import { parse } from "yaml";

export class UnknownPartnerBrandTenantError extends Error {}
export class IneligiblePartnerBrandTenantError extends Error {}
export class AmbiguousPartnerBrandRegistryError extends Error {}

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

function findBlock(lines: string[], slug: string): { start: number; end: number } | null {
  const header = new RegExp(String.raw`^ {2}${escapeForRegex(slug)}:\s*$`);
  const headers = lines.flatMap((line, index) => (header.test(line) ? [index] : []));
  if (headers.length > 1) throw new AmbiguousPartnerBrandRegistryError(`duplicate '${slug}' tenant`);
  const start = headers[0] ?? -1;
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "" || /^ {4,}/.test(lines[i])) continue;
    end = i;
    break;
  }
  return { start, end };
}

function fieldRaws(lines: string[], key: string, block: { start: number; end: number }): string[] {
  const field = new RegExp(String.raw`^ {4}(?:${escapeForRegex(key)}|["']${escapeForRegex(key)}["'])\s*:`);
  const strict = new RegExp(String.raw`^ {4}${escapeForRegex(key)}:\s*(.*)$`);
  const matches: string[] = [];
  for (let i = block.start + 1; i < block.end; i++) {
    if (!field.test(lines[i])) continue;
    const match = strict.exec(lines[i]);
    if (!match) throw new AmbiguousPartnerBrandRegistryError(`unsupported '${key}' field syntax`);
    matches.push(match[1]);
  }
  if (matches.length > 1) throw new AmbiguousPartnerBrandRegistryError(`duplicate '${key}' field`);
  return matches;
}

function scalarValue(raw: string, key: string): unknown {
  if (/^[|>][+-]?$/.test(raw.trim())) {
    throw new AmbiguousPartnerBrandRegistryError(`unsupported block scalar for '${key}'`);
  }
  try {
    return parse(raw);
  } catch {
    throw new AmbiguousPartnerBrandRegistryError(`invalid YAML scalar for '${key}'`);
  }
}

type FieldValue = { present: false } | { present: true; value: unknown };

function uniqueFieldValue(lines: string[], key: string, block: { start: number; end: number }): FieldValue {
  const [raw] = fieldRaws(lines, key, block);
  return raw === undefined ? { present: false } : { present: true, value: scalarValue(raw, key) };
}

function fieldIndexes(lines: string[], key: string, block: { start: number; end: number }): number[] {
  const field = new RegExp(String.raw`^ {4}(?:${escapeForRegex(key)}|["']${escapeForRegex(key)}["'])\s*:`);
  return lines.flatMap((line, index) => (index > block.start && index < block.end && field.test(line) ? [index] : []));
}

function attributionOptedOut(value: FieldValue): boolean {
  if (!value.present) return false;
  if (value.value === false || (typeof value.value === "string" && value.value.toLowerCase() === "false")) {
    return true;
  }
  if (value.value === true || (typeof value.value === "string" && value.value.toLowerCase() === "true")) {
    return false;
  }
  throw new AmbiguousPartnerBrandRegistryError("invalid 'partner_attribution' value");
}

/** Read the exact safety boundary used by the existing-site apply action. */
export function partnerBrandTenantState(
  registryYaml: string,
  slug: string,
): { eligible: boolean; optedOut: boolean } {
  const lines = registryYaml.split("\n");
  const block = findBlock(lines, slug);
  if (!block) throw new UnknownPartnerBrandTenantError(`registry has no '${slug}' tenant`);
  const status = uniqueFieldValue(lines, "status", block);
  const managed = uniqueFieldValue(lines, "managed", block);
  const optedOut = attributionOptedOut(uniqueFieldValue(lines, "partner_attribution", block));
  const eligible = status.present && status.value === "active" && managed.present && managed.value === "scripts";
  return { eligible, optedOut };
}

/**
 * Set or remove only the two public fields this feature owns. `null` means the
 * partner opted out, entered only their legal name, or cleared the public brand.
 * A restaurant's explicit `partner_attribution: false` is preserved and wins.
 */
export function setRegistryPartnerBrand(
  registryYaml: string,
  slug: string,
  brand: RenderableBrand | null,
): { yaml: string; changed: boolean; optedOut: boolean } {
  const lines = registryYaml.split("\n");
  const block = findBlock(lines, slug);
  if (!block) throw new UnknownPartnerBrandTenantError(`registry has no '${slug}' tenant`);

  const status = uniqueFieldValue(lines, "status", block);
  const managed = uniqueFieldValue(lines, "managed", block);
  const optedOut = attributionOptedOut(uniqueFieldValue(lines, "partner_attribution", block));
  if (!status.present || status.value !== "active" || !managed.present || managed.value !== "scripts") {
    throw new IneligiblePartnerBrandTenantError(`'${slug}' is not an active script-managed tenant`);
  }

  if (brand) {
    const displayName = brand.displayName.trim();
    if (!displayName || displayName.length > 80 || /[\r\n\u0000]/.test(displayName)) {
      throw new AmbiguousPartnerBrandRegistryError("invalid partner display name");
    }
    if (brand.websiteUrl && !isHttpsUrl(brand.websiteUrl)) {
      throw new AmbiguousPartnerBrandRegistryError("partner website must use https");
    }
  }

  const nameIndexes = fieldIndexes(lines, "partner_name", block);
  const urlIndexes = fieldIndexes(lines, "partner_url", block);
  if (nameIndexes.length > 1 || urlIndexes.length > 1) {
    throw new AmbiguousPartnerBrandRegistryError("duplicate partner brand field");
  }
  const existing = [...nameIndexes, ...urlIndexes];

  const currentName = uniqueFieldValue(lines, "partner_name", block);
  const currentUrl = uniqueFieldValue(lines, "partner_url", block);
  if (currentName.present && typeof currentName.value !== "string") {
    throw new AmbiguousPartnerBrandRegistryError("invalid 'partner_name' value");
  }
  if (currentUrl.present && typeof currentUrl.value !== "string") {
    throw new AmbiguousPartnerBrandRegistryError("invalid 'partner_url' value");
  }

  // If the exact requested projection is already present, preserve the source
  // bytes. Moving the same fields to the bottom would create a noisy PR for no
  // actual change and could churn hand-maintained comments around them.
  if (brand && !optedOut && nameIndexes.length === 1 && currentName.present && currentName.value === brand.displayName.trim() &&
      (brand.websiteUrl
        ? urlIndexes.length === 1 && currentUrl.present && currentUrl.value === brand.websiteUrl
        : urlIndexes.length === 0)) {
    return { yaml: registryYaml, changed: false, optedOut };
  }
  if ((!brand || optedOut) && existing.length === 0) {
    return { yaml: registryYaml, changed: false, optedOut };
  }
  const next = [...lines];
  for (const index of existing.reverse()) next.splice(index, 1);

  if (brand && !optedOut) {
    // JSON strings are valid YAML double-quoted scalars. Quoting every value
    // prevents `:`, `#`, quotes, and newlines from changing registry structure.
    const values = [`    partner_name: ${JSON.stringify(brand.displayName.trim())}`];
    if (brand.websiteUrl) values.push(`    partner_url: ${JSON.stringify(brand.websiteUrl)}`);
    next.splice(block.end - existing.length, 0, ...values);
  }

  const yaml = next.join("\n");
  return { yaml, changed: yaml !== registryYaml, optedOut };
}
