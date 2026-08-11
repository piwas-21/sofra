// The write side of a VAT check: which columns to store, and whose identity it is.
// (SOFRA-BILLING-IDENTITY-PLAN B1/B2.)
//
// Split out of lib/actions/billing-identity-actions.ts when that file outgrew the
// §4 limit, and the seam is a real one rather than a length fix: everything here
// is shared verbatim by the admin surface and by B5's payer-facing form, so the
// two cannot drift on the one decision that matters — what a failed VIES call is
// allowed to do to a previously proven status.
//
// Not unit-tested directly (it calls the network); the JUDGEMENT it applies lives
// in lib/billing-identity.ts, which is pure and is where the rules are pinned.

import {
  canSkipVatCheck,
  carriedStatusFor,
  nextVatStatus,
  shouldReplaceVatEvidence,
  type StoredVat,
} from "@/lib/billing-identity";
import { normalizeVatNumber } from "@/lib/vat-number";
import { checkVatNumber } from "@/lib/vies";
import type { BuyerVatStatus } from "@/lib/tax-treatment";

export type VatFields = {
  vatNumber: string | null;
  vatStatus: BuyerVatStatus;
  vatCheckedAt?: Date | null;
  vatCheckRef?: string | null;
  vatCheckDetail?: string | null;
  vatCheckName?: string | null;
};

/** Nothing is known about this number: used when it is new, or cleared. */
const UNKNOWN_VAT: VatFields = {
  vatNumber: null,
  vatStatus: "NONE",
  vatCheckedAt: null,
  vatCheckRef: null,
  vatCheckDetail: null,
  vatCheckName: null,
};

/**
 * The VAT columns to write.
 *
 * **The stored status belongs to the stored NUMBER, and carrying it across a
 * substitution is the dangerous case.** Take a VALID `FR27981106214` with its
 * consultation reference, change the number to something else, and have VIES
 * throttle (measured at 5 calls in 8 on the FR node): the outage-preservation
 * rule would keep `VALID` — for a number nobody ever checked — and keep the OLD
 * number's reference as its evidence. That is a 0%-rated reverse-charge invoice
 * and an ICP line for an unverified number. So a changed number starts from
 * `NONE`: nothing is proven about it, because nothing has been asked about it.
 *
 * The network call is also skipped when the number is unchanged AND already
 * settled (VALID or INVALID) — a member state's answer does not change between
 * two saves, and re-asking would make correcting a typo in `city` block for up to
 * 40s on a third-party call. `recheckVatAction` is the deliberate way to re-ask,
 * which is what an UNCHECKED/UNAVAILABLE/NONE row still falls through to here.
 */
export async function vatFieldsFor(
  rawVatNumber: string,
  stored: StoredVat | null,
  { force = false }: { force?: boolean } = {},
): Promise<VatFields> {
  // Normalize FIRST: a value of only separators ("-") is not a number, and
  // storing it as an empty string with a verdict attached would be a lie.
  const vatNumber = normalizeVatNumber(rawVatNumber);
  if (!vatNumber) return UNKNOWN_VAT;

  if (canSkipVatCheck(stored, vatNumber, force)) {
    return { vatNumber, vatStatus: stored!.vatStatus };
  }

  // Only a status proven for THIS number may be preserved through an outage.
  const current = carriedStatusFor(stored, vatNumber);
  const outcome = await checkVatNumber(vatNumber);
  const status = nextVatStatus(current, outcome.status);

  if (!shouldReplaceVatEvidence(current, outcome.status)) {
    // A proven VALID survived an unreachable VIES. Keep its reference and date
    // untouched: re-stamping them with the moment we FAILED to reach VIES would
    // read as "verified today" on an invoice and in an audit. Reachable only when
    // `sameNumber`, by the branch above.
    return { vatNumber, vatStatus: status };
  }
  return {
    vatNumber,
    vatStatus: status,
    vatCheckedAt: new Date(),
    vatCheckRef: outcome.ref,
    vatCheckDetail: outcome.detail,
    vatCheckName: outcome.name,
  };
}

/**
 * Which USER is this legal entity? `payerUserId` for a direct owner (ADR-004),
 * the CRM client's partner for the reseller flow — exactly the pair
 * `defineTenantPlan` writes. Null for a tenant with no account behind it, which
 * is RUMI's case and the reason the column is nullable.
 *
 * This is what makes the table party-scoped rather than plan-scoped: without it a
 * reseller holding three tenants accumulates three identity rows free to drift,
 * which is precisely the failure the separate table exists to prevent.
 */
export function partyOf(billing: {
  payerUserId: string | null;
  client: { partnerId: string } | null;
}): string | null {
  return billing.payerUserId ?? billing.client?.partnerId ?? null;
}
