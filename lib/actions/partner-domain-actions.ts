"use server";

// A partner registers a zone of their own, and proves it
// (SOFRA-PARTNER-FLEXIBILITY-PLAN D1/D1b).
//
// The first reseller wants his clients under `*.solutioneva.com`. Nothing in this
// app could express that: `/admin/provision` is founder-only, and the registry
// hardcodes `sofrapiwas.com` for every subdomain tenant. These three actions are
// the partner-facing half — claim, prove, drop — and they write NOTHING outside
// this app's own table. The registry stays founder-run (ADR-003/007).
//
// The proof is the whole security boundary. An unverified row is inert everywhere:
// no surface offers it, and `verifiedBaseDomains` is the only list any chooser is
// allowed to read.

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeBaseDomain } from "@/lib/base-domain";
import {
  mintVerificationToken,
  txtMatchesToken,
  verifyRecordName,
} from "@/lib/base-domain-verification";
import { lookupVerificationTxt } from "@/lib/base-domain-dns";
import { ownBaseDomain } from "@/lib/partner-domain-access";

/** `error` is a message key in `control.errors` (rendered by <ActionError />). */
export type BaseDomainState = { error?: string; ok?: boolean; verified?: boolean };

/** How many zones one partner may claim. Not a business rule — a bound on a table a
 *  logged-in user can insert into, and on the number of outbound lookups one account
 *  can queue up. A partner who genuinely needs more asks; nobody has needed two. */
const MAX_DOMAINS_PER_PARTNER = 5;

const readId = (formData: FormData): string => {
  // Read as a string rather than String(...): a FormData value can be a File, and
  // stringifying one yields "[object Object]" — a lookup that would then MISS rather
  // than refuse (Sonar S6551, same shape as `requestClientChangeAction`).
  const raw = formData.get("id");
  return typeof raw === "string" ? raw : "";
};

/**
 * Claim a base domain. Stored UNVERIFIED with a fresh token.
 *
 * Re-claiming a domain the partner already holds is a no-op that returns the
 * existing row rather than an error: the button is on the same page as the
 * instructions, and a partner who resubmits should not be told off, nor should
 * their token be rotated — rotating it would silently invalidate the TXT record
 * they may already have published.
 */
export async function claimBaseDomainAction(
  _prev: BaseDomainState,
  formData: FormData,
): Promise<BaseDomainState> {
  const partner = await requirePartner();
  if (!rateLimit(`base-domain:claim:${partner.id}`, 10, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const raw = formData.get("domain");
  const parsed = normalizeBaseDomain(typeof raw === "string" ? raw : "");
  if (!parsed.ok) return { error: `baseDomain.${parsed.reason}` };
  const domain = parsed.domain;

  const existing = await db.partnerDomain.findFirst({ where: { partnerId: partner.id, domain } });
  if (existing) return { ok: true, verified: existing.verifiedAt !== null };

  const count = await db.partnerDomain.count({ where: { partnerId: partner.id } });
  if (count >= MAX_DOMAINS_PER_PARTNER) return { error: "baseDomain.tooMany" };

  const created = await db.partnerDomain.create({
    data: { partnerId: partner.id, domain, verifyToken: mintVerificationToken() },
  });
  // The domain is logged: it is a company's public zone, not personal data, and the
  // audit row is worthless without knowing WHICH zone was claimed. The token is not —
  // it is public by construction but there is no reason to copy it into a second place.
  await audit(partner.id, "partner.base_domain.claimed", "PartnerDomain", created.id, { domain });

  revalidatePath("/dashboard/domains");
  return { ok: true, verified: false };
}

/**
 * Check the TXT record and, if it matches, mark the domain verified.
 *
 * Rate-limited hard, and per PARTNER rather than per IP: this is the one
 * authenticated path in the control plane that makes an outbound DNS query on a
 * name a user typed, and `partner.id` has no NAT collisions and no spoofable proxy
 * header (same reasoning as `startPaymentAction`).
 *
 * `lastCheckedAt` is written on EVERY outcome, including failure. "Never looked" and
 * "looked, still not published" are different states, and only the second one tells
 * the partner their record has not landed yet rather than that they forgot to press
 * the button.
 *
 * A resolver failure is NEVER recorded as a failed proof, and never clears an
 * existing `verifiedAt` — an outage on our side must not retract a proof, for the
 * same reason a VIES `UNAVAILABLE` must never overwrite a `VALID` (ADR-013).
 */
export async function verifyBaseDomainAction(
  _prev: BaseDomainState,
  formData: FormData,
): Promise<BaseDomainState> {
  const partner = await requirePartner();
  const row = await ownBaseDomain(partner.id, readId(formData));
  if (!row) return { error: "baseDomain.unknownDomain" };

  if (!rateLimit(`base-domain:verify:${partner.id}`, 10, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const lookup = await lookupVerificationTxt(verifyRecordName(row.domain));
  const now = new Date();
  await db.partnerDomain.update({ where: { id: row.id }, data: { lastCheckedAt: now } });

  if (!lookup.ok) {
    await audit(partner.id, "partner.base_domain.check_failed", "PartnerDomain", row.id, {
      domain: row.domain,
      reason: lookup.reason,
    });
    revalidatePath("/dashboard/domains");
    // Named apart from the row-not-found case above: "we could not find your TXT
    // record" and "that claim is not yours" are the same word and opposite advice.
    return {
      error:
        lookup.reason === "notFound" ? "baseDomain.recordNotFound" : "baseDomain.lookupFailed",
    };
  }

  if (!txtMatchesToken(lookup.records, row.verifyToken)) {
    await audit(partner.id, "partner.base_domain.check_failed", "PartnerDomain", row.id, {
      domain: row.domain,
      reason: "tokenMismatch",
    });
    revalidatePath("/dashboard/domains");
    return { error: "baseDomain.tokenMismatch" };
  }

  // Re-verifying an already-verified domain MOVES the date forward. That is the
  // point: `verifiedAt` is how fresh the proof is, and a partner re-proving a zone
  // they still hold should reset the clock the founder reads.
  await db.partnerDomain.update({ where: { id: row.id }, data: { verifiedAt: now } });
  await audit(partner.id, "partner.base_domain.verified", "PartnerDomain", row.id, {
    domain: row.domain,
  });

  revalidatePath("/dashboard/domains");
  return { ok: true, verified: true };
}

/**
 * Drop a claim.
 *
 * Deleting the row removes it from every chooser immediately. It does NOT touch a
 * tenant already living under that zone — those are registry entries and Caddy site
 * blocks the founder owns, and this app cannot edit them (ADR-003/007). The UI says
 * so at the moment of removal, because "remove" that silently left three live
 * restaurants running is the reading a partner would otherwise take away.
 */
export async function removeBaseDomainAction(
  _prev: BaseDomainState,
  formData: FormData,
): Promise<BaseDomainState> {
  const partner = await requirePartner();
  const row = await ownBaseDomain(partner.id, readId(formData));
  if (!row) return { error: "baseDomain.unknownDomain" };

  await db.partnerDomain.delete({ where: { id: row.id } });
  await audit(partner.id, "partner.base_domain.removed", "PartnerDomain", row.id, {
    domain: row.domain,
    wasVerified: row.verifiedAt !== null,
  });

  revalidatePath("/dashboard/domains");
  return { ok: true };
}
