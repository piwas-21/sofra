// Public, surgical edits to existing tenant entries for partner public credit.
// The line-based helpers preserve comments and unrelated hand-maintained YAML.

import type { RenderableBrand } from "@/lib/partner-brand";
import {
  AmbiguousPartnerBrandRegistryError,
  IneligiblePartnerBrandTenantError,
  UnknownPartnerBrandTenantError,
  assertNoUnsupportedYamlReferences,
  findPartnerBrandTenantBlock,
  inspectTenantPartnerBrandState,
  isPartnerBrandAlreadyCurrent,
  readExistingPartnerBrandFields,
  replacePartnerBrandFields,
  validatePublicBrand,
} from "@/lib/partner-brand-registry-edit-helpers";

export {
  AmbiguousPartnerBrandRegistryError,
  IneligiblePartnerBrandTenantError,
  UnknownPartnerBrandTenantError,
};

/** Read the exact safety boundary used by the existing-site apply action. */
export function partnerBrandTenantState(
  registryYaml: string,
  slug: string,
): { eligible: boolean; optedOut: boolean } {
  const lines = registryYaml.split("\n");
  const block = findPartnerBrandTenantBlock(lines, slug);
  if (!block) throw new UnknownPartnerBrandTenantError(`registry has no '${slug}' tenant`);
  assertNoUnsupportedYamlReferences(lines, block);
  return inspectTenantPartnerBrandState(lines, block);
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
  const block = findPartnerBrandTenantBlock(lines, slug);
  if (!block) throw new UnknownPartnerBrandTenantError(`registry has no '${slug}' tenant`);
  assertNoUnsupportedYamlReferences(lines, block);
  const tenant = inspectTenantPartnerBrandState(lines, block);
  if (!tenant.eligible) {
    throw new IneligiblePartnerBrandTenantError(`'${slug}' is not an active script-managed tenant`);
  }
  const displayName = validatePublicBrand(brand);
  const fields = readExistingPartnerBrandFields(lines, block);

  // Preserve the source bytes when the exact public projection is already set.
  if (isPartnerBrandAlreadyCurrent(fields, brand, displayName, tenant.optedOut)) {
    return { yaml: registryYaml, changed: false, optedOut: tenant.optedOut };
  }
  const yaml = replacePartnerBrandFields(lines, block, fields, brand, displayName, tenant.optedOut);
  return { yaml, changed: yaml !== registryYaml, optedOut: tenant.optedOut };
}
