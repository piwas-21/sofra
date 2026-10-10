import type { RenderableBrand } from "@/lib/partner-brand";

/** The proposal is a review checkpoint; merging alone does not update a running tenant. */
export function partnerBrandRegistryPrBody(
  slug: string,
  brand: RenderableBrand | null,
  optedOut: boolean,
): string {
  const change = brand && !optedOut
    ? "The diff contains only the opted-in public display name and optional HTTPS website URL."
    : "The diff removes prior partner name and URL fields; the restaurant-owned opt-out is preserved.";
  return [
    `## Existing partner site: \`${slug}\``,
    "",
    change,
    "No legal identity or contact details are copied into the tenant registry.",
    "",
    "This PR is a proposal, not a publication. After review and merge, re-run the deploy repo's tenant provisioning workflow for this slug so the tenant environment is regenerated and the backend is recreated. Verify the resulting runtime partner-brand values before treating the change as live.",
    "",
    "- [ ] Confirm the tenant is active and script-managed.",
    optedOut || !brand
      ? "- [ ] Confirm partner name and URL are removed while any restaurant opt-out stays intact."
      : "- [ ] Confirm the restaurant has not opted out of partner attribution.",
    "- [ ] After merge, recreate the tenant backend and verify runtime values.",
  ].join("\n");
}
