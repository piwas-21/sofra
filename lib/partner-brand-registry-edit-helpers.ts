// Pure parsing and projection helpers for line-based tenant registry edits.
// Keep them measurable: the registry is hand-maintained and every boundary
// here protects comments, attribution choices, or tenant identity.

import { isHttpsUrl, type RenderableBrand } from "@/lib/partner-brand";
import { parse } from "yaml";

export class UnknownPartnerBrandTenantError extends Error {}
export class IneligiblePartnerBrandTenantError extends Error {}
export class AmbiguousPartnerBrandRegistryError extends Error {}

export type RegistryTenantBlock = { start: number; end: number };
type FieldValue = { present: false } | { present: true; value: unknown };

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export function findPartnerBrandTenantBlock(lines: string[], slug: string): RegistryTenantBlock | null {
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

export function assertNoUnsupportedYamlReferences(lines: string[], block: RegistryTenantBlock): void {
  for (let index = block.start + 1; index < block.end; index++) {
    const line = lines[index];
    if (/^ {4}<<\s*:/.test(line)) {
      throw new AmbiguousPartnerBrandRegistryError("unsupported YAML merge key in tenant block");
    }
    if (/^ {4}[^#][^:]*:\s*(?:![^\s]+\s+)?[&*][A-Za-z0-9_-]+(?:\s|$)/.test(line)) {
      throw new AmbiguousPartnerBrandRegistryError("unsupported YAML anchor or alias in tenant block");
    }
  }
}

function fieldRaws(lines: string[], key: string, block: RegistryTenantBlock): string[] {
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

function uniqueFieldValue(lines: string[], key: string, block: RegistryTenantBlock): FieldValue {
  const [raw] = fieldRaws(lines, key, block);
  return raw === undefined ? { present: false } : { present: true, value: scalarValue(raw, key) };
}

function fieldIndexes(lines: string[], key: string, block: RegistryTenantBlock): number[] {
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

export function inspectTenantPartnerBrandState(
  lines: string[],
  block: RegistryTenantBlock,
): { eligible: boolean; optedOut: boolean } {
  const status = uniqueFieldValue(lines, "status", block);
  const managed = uniqueFieldValue(lines, "managed", block);
  const optedOut = attributionOptedOut(uniqueFieldValue(lines, "partner_attribution", block));
  return {
    eligible: status.present && status.value === "active" && managed.present && managed.value === "scripts",
    optedOut,
  };
}

function hasDisplayNameControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (typeof codePoint === "number" && (codePoint === 0 || codePoint === 10 || codePoint === 13)) return true;
  }
  return false;
}

export function validatePublicBrand(brand: RenderableBrand | null): string | null {
  if (!brand) return null;
  const displayName = brand.displayName.trim();
  if (!displayName || displayName.length > 80 || hasDisplayNameControlCharacter(displayName)) {
    throw new AmbiguousPartnerBrandRegistryError("invalid partner display name");
  }
  if (brand.websiteUrl && !isHttpsUrl(brand.websiteUrl)) {
    throw new AmbiguousPartnerBrandRegistryError("partner website must use https");
  }
  return displayName;
}

export type ExistingPartnerBrandFields = {
  nameIndexes: number[];
  urlIndexes: number[];
  name: string | undefined;
  url: string | undefined;
};

function stringFieldValue(field: FieldValue, key: string): string | undefined {
  if (!field.present) return undefined;
  if (typeof field.value !== "string") {
    throw new AmbiguousPartnerBrandRegistryError(`invalid '${key}' value`);
  }
  return field.value;
}

export function readExistingPartnerBrandFields(
  lines: string[],
  block: RegistryTenantBlock,
): ExistingPartnerBrandFields {
  const nameIndexes = fieldIndexes(lines, "partner_name", block);
  const urlIndexes = fieldIndexes(lines, "partner_url", block);
  if (nameIndexes.length > 1 || urlIndexes.length > 1) {
    throw new AmbiguousPartnerBrandRegistryError("duplicate partner brand field");
  }
  return {
    nameIndexes,
    urlIndexes,
    name: stringFieldValue(uniqueFieldValue(lines, "partner_name", block), "partner_name"),
    url: stringFieldValue(uniqueFieldValue(lines, "partner_url", block), "partner_url"),
  };
}

export function isPartnerBrandAlreadyCurrent(
  fields: ExistingPartnerBrandFields,
  brand: RenderableBrand | null,
  displayName: string | null,
  optedOut: boolean,
): boolean {
  if (!brand || optedOut || !displayName) {
    return fields.nameIndexes.length === 0 && fields.urlIndexes.length === 0;
  }
  const nameMatches = fields.nameIndexes.length === 1 && fields.name === displayName;
  const urlMatches = brand.websiteUrl
    ? fields.urlIndexes.length === 1 && fields.url === brand.websiteUrl
    : fields.urlIndexes.length === 0;
  return nameMatches && urlMatches;
}

export function replacePartnerBrandFields(
  lines: string[],
  block: RegistryTenantBlock,
  fields: ExistingPartnerBrandFields,
  brand: RenderableBrand | null,
  displayName: string | null,
  optedOut: boolean,
): string {
  const existingIndexes = [...fields.nameIndexes, ...fields.urlIndexes]
    .sort((left, right) => right - left);
  const next = [...lines];
  for (const index of existingIndexes) next.splice(index, 1);

  if (brand && !optedOut && displayName) {
    const values = [`    partner_name: ${JSON.stringify(displayName)}`];
    if (brand.websiteUrl) values.push(`    partner_url: ${JSON.stringify(brand.websiteUrl)}`);
    next.splice(block.end - existingIndexes.length, 0, ...values);
  }
  return next.join("\n");
}
