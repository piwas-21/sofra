// The ownership test every partner base-domain write and read shares.
//
// Deliberately NOT a "use server" module, for the same reason `lib/client-access.ts`
// is not: exporting this from one would publish it as a callable server-action
// endpoint whose FIRST argument is the partner id — i.e. a remote "read any
// partner's base domain" primitive. It lives here so the action file and the page
// can share the one query without that ever becoming possible.

import { db } from "@/lib/db";

/** Loads a claimed base domain iff it belongs to the calling partner. The ONLY way a
 *  partner action may touch one (SOFRA-PARTNER-PLAN §5: every partner query is scoped
 *  by `partnerId` server-side). */
export async function ownBaseDomain(partnerId: string, id: string) {
  return db.partnerDomain.findFirst({ where: { id, partnerId } });
}

/** Every base domain a partner has claimed, newest verified first. */
export async function partnerBaseDomains(partnerId: string) {
  return db.partnerDomain.findMany({
    where: { partnerId },
    orderBy: [{ verifiedAt: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * The base domains a partner may actually USE — verified only.
 *
 * A separate function rather than a boolean argument, because "list what they have"
 * and "list what they may build on" are different questions and the second one is
 * the security-relevant one. A caller that has to remember a flag eventually forgets
 * it, and the forgotten case is the one that offers an unproven zone as an option.
 */
export async function verifiedBaseDomains(partnerId: string) {
  return db.partnerDomain.findMany({
    where: { partnerId, verifiedAt: { not: null } },
    orderBy: { domain: "asc" },
  });
}

/**
 * Every PROVEN base domain, whoever claimed it, with the partner it belongs to.
 *
 * The one read here that is deliberately NOT scoped by `partnerId` — it exists for
 * `/admin/provision`, which is `requireAdmin()` and is the surface where the founder
 * places somebody else's client under somebody else's zone. It is the caller's guard
 * that makes it safe, which is exactly why it is a separately-named function: an
 * unscoped read that shared a name with a scoped one would eventually be called from a
 * partner surface by someone who read the name and not the query.
 *
 * Verified only, for the same reason the partner's own list is: an unproven zone is a
 * name we cannot show a certificate for, and offering it to the founder would move the
 * mistake from "refused" to "provisioned without TLS".
 */
export async function allVerifiedBaseDomains() {
  return db.partnerDomain.findMany({
    where: { verifiedAt: { not: null } },
    orderBy: { domain: "asc" },
    select: { domain: true, partner: { select: { name: true } } },
  });
}
