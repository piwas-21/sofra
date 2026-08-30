// Which partner, if any, may be credited in a tenant's footer (SOFRA-PARTNER-PLAN
// §11e). The DB half of the feature, deliberately separate from the pure rules in
// lib/partner-brand.ts: this file only GATHERS the two records, and the decision
// stays behind `renderableBrand`, which is the one door.
//
// Out of the vitest coverage floor for the reason `vies.ts` is — it queries — while
// everything it can get wrong about publishing is decided in a module that is in.

import { db } from "@/lib/db";
import { renderableBrand, type RenderableBrand } from "@/lib/partner-brand";

/**
 * The publishable brand of the partner who sold this tenant, or `undefined`.
 *
 * `undefined`, not `null`, because that is what `TenantProvisionInput.partnerBrand`
 * wants: absence is the contract there, and an entry with no credit must be
 * byte-identical to one generated before the field existed.
 *
 * The slug is matched two ways on purpose. `Client.tenantSlug` is set by an ADMIN
 * *after* provisioning, so at the moment a registry PR is proposed it is usually
 * still null; the reseller's PLAN, however, already names the slug. Looking only at
 * `Client.tenantSlug` would therefore have credited nobody on exactly the path this
 * feature exists for, and the failure would have been silent — an entry with no
 * partner keys reads the same as a partner who never opted in.
 *
 * Fails OPEN, to no credit: a database hiccup here must not stop a paid customer's
 * tenant being proposed, and the cost of the safe direction is a missing footer line
 * that a re-provision restores. The opposite direction is unrecoverable in kind —
 * publishing a name because a lookup misfired.
 */
export async function tenantPartnerBrand(tenantSlug: string): Promise<RenderableBrand | undefined> {
  try {
    const client = await db.client.findFirst({
      where: { OR: [{ tenantSlug }, { billing: { tenantSlug } }] },
      select: { partnerId: true },
    });
    if (!client) return undefined;

    // The legal name is fetched for ONE purpose — the D-B1a refusal — and never
    // travels further: `renderableBrand` compares with it and does not return it.
    const [brand, identity] = await Promise.all([
      db.partnerBrand.findUnique({ where: { partnerId: client.partnerId } }),
      db.billingIdentity.findUnique({
        where: { userId: client.partnerId },
        select: { legalName: true },
      }),
    ]);
    return renderableBrand(brand, { legalName: identity?.legalName }) ?? undefined;
  } catch (e) {
    // Slug only: a brand is a company's, and for a sole trader a person's (§5.8).
    console.error("tenantPartnerBrand failed; proposing without a credit", tenantSlug, e);
    return undefined;
  }
}
