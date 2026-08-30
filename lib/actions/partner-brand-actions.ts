"use server";

// A partner records the public brand their clients' guests may be shown
// (SOFRA-PARTNER-PLAN §11).
//
// This slice STORES and EDITS. It publishes nothing: no tenant site reads
// `PartnerBrand`, and `publishToTenants` is an intent flag whose only future
// reader is `renderableBrand()` (§11e — the owner gate). The write path is built
// now so that the day publishing is switched on, the details it publishes are
// ones the partner typed knowing they were public — rather than the legal record,
// which is a person's own name and home address for a sole trader.

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { checkboxOn, partnerBrandSchema } from "@/lib/partner-brand";

/** `error` is a message key in `control.errors` (rendered by <ActionError />);
 *  Zod issue messages pass through raw, as elsewhere in this directory. */
export type PartnerBrandState = { error?: string; ok?: boolean };

export async function savePartnerBrandAction(
  _prev: PartnerBrandState,
  formData: FormData,
): Promise<PartnerBrandState> {
  // `requirePartner()`, not `requirePartnerOrOwner()`: a brand is what a RESELLER
  // shows on the restaurants they sell. A direct restaurant OWNER has one tenant,
  // which is their own — there is no third party for them to be credited as, so
  // this surface has nothing to offer them and they are bounced to /dashboard.
  const partner = await requirePartner();

  // Per `user.id` rather than per IP, matching the sibling partner actions: the
  // actor is authenticated, so their id has no NAT collisions and no spoofable
  // proxy header behind it.
  if (!rateLimit(`partner-brand:${partner.id}`, 30, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const parsed = partnerBrandSchema.safeParse({
    ...Object.fromEntries(formData),
    // A checkbox is absent from FormData when unticked, so it can never be read
    // straight off the payload as a boolean. Anything that is not "on"/"true" is
    // off — the safe direction for a flag whose true value means "show this to
    // the public".
    publishToTenants: checkboxOn(formData.get("publishToTenants")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const input = parsed.data;

  // An emptied field must be CLEARED, not left alone. The schema normalises a
  // blank input to `undefined` (there is no "" state to store), and Prisma reads
  // `undefined` in an update as "do not touch this column" — so passing the
  // parsed object straight through would make deleting a tagline impossible: the
  // partner would save, be told it worked, and reload to find the old line still
  // there. `null` is the write that means "gone".
  const data = {
    displayName: input.displayName,
    tagline: input.tagline ?? null,
    websiteUrl: input.websiteUrl ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressLine1: input.addressLine1 ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    countryCode: input.countryCode ?? null,
    publishToTenants: input.publishToTenants,
  };

  // The key comes from the SESSION and is never read from the payload. A
  // `partnerId` field in the FormData would be an IDOR: any logged-in partner
  // could rewrite another's public details, which is both a takeover of their
  // identity and — once publishing exists — a way to put text on someone else's
  // restaurant pages. `partnerId` is written LAST so that no spread can shadow
  // it, even if the schema were later loosened to pass unknown keys through.
  const row = await db.partnerBrand.upsert({
    where: { partnerId: partner.id },
    create: { ...data, partnerId: partner.id },
    update: data,
  });

  // No brand FIELD is logged. They are contact details of a real company and, in
  // the sole-trader case, of a real person (CLAUDE.md §5.8 — no PII in logs). What
  // the audit row needs is that the record was written and whether the partner
  // asked for it to be public; the values themselves are one `SELECT` away for
  // anyone entitled to read them.
  await audit(partner.id, "partner.brand.saved", "PartnerBrand", row.partnerId, {
    publishToTenants: row.publishToTenants,
  });

  revalidatePath("/dashboard/brand");
  return { ok: true };
}
