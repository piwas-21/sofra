// Proving a partner actually controls the base domain they claimed.
//
// This is the security boundary of the whole partner-domain feature. Without it a
// partner types `google.com`, we accept it, and the moment a client is provisioned
// under it we ask Let's Encrypt for a certificate for a name we do not own and
// serve content from it. The claim is therefore worth nothing until a TXT record
// only the zone's operator could publish comes back with OUR token in it.
//
// Pure: it decides the record NAME, the record VALUE, whether a resolver's answer
// matches, and how old a proof is. The lookup itself lives in `base-domain-dns.ts`
// (network) and the writes live in the action — so every judgement here is a unit
// test rather than a live DNS query.

import { randomBytes } from "node:crypto";

/** The label the proof lives under. Prefixed with `_` like every other service's
 *  verification record, so it can never collide with a real host in the partner's
 *  zone — a partner must be able to publish this without touching anything live. */
export const VERIFY_PREFIX = "_sofra-verify";

/** Value prefix, so the record says what it is. A bare token in a zone file is
 *  unattributable six months later, and a partner clearing out old records has no
 *  way to tell whose it is. */
const VALUE_PREFIX = "sofra-verify=";

/**
 * How long a proof is treated as FRESH.
 *
 * 180 days, and the number is a display threshold — not an expiry. See
 * `verificationAge`: nothing here revokes anything.
 */
export const STALE_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The full record name the partner publishes. */
export function verifyRecordName(domain: string): string {
  return `${VERIFY_PREFIX}.${domain}`;
}

/** The exact string the TXT record must contain. */
export function expectedTxtValue(token: string): string {
  return `${VALUE_PREFIX}${token}`;
}

/**
 * Mint a verification token.
 *
 * 32 bytes of `randomBytes`, hex — unguessable, which is the only property that
 * matters: two partners may claim the same domain (see the action), and what
 * separates them is that each can only ever satisfy their OWN token.
 *
 * Deliberately stored in PLAINTEXT, unlike `lib/tokens.ts`'s invite/reset hashes.
 * The partner has to publish this value in public DNS — it is a public artefact by
 * construction, and hashing it would only mean we could never show it to them
 * again, on the one surface whose entire job is to show it to them.
 */
export function mintVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Does a resolver's answer carry our token?
 *
 * `resolveTxt` returns one array of STRINGS per record, because a TXT record over
 * 255 bytes is transmitted as several character-strings that the consumer
 * concatenates — with no separator. Joining with anything else (a space, a comma)
 * is the classic way to fail verification for a zone that is, in fact, correct.
 *
 * Surrounding quotes are stripped because some zone editors store them as part of
 * the value; whitespace is trimmed for the same reason. Any ONE record matching is
 * enough: a real zone routinely carries several TXT records at the same name (SPF,
 * other vendors' proofs), and requiring a lone record would fail every partner who
 * verifies with a second provider.
 */
export function txtMatchesToken(records: readonly (readonly string[])[], token: string): boolean {
  if (!token) return false;
  const expected = expectedTxtValue(token);
  return records.some((chunks) => {
    const value = chunks.join("").trim().replace(/^"(.*)"$/s, "$1").trim();
    return value === expected;
  });
}

/** How a proof stands right now. */
export interface VerificationAge {
  verified: boolean;
  /** Whole days since the proof, or null when there is no proof. */
  ageDays: number | null;
  /** Older than STALE_AFTER_DAYS. Informational — see below. */
  stale: boolean;
}

/**
 * Judge an existing proof against the clock.
 *
 * **Policy: we record `verifiedAt`, we surface staleness, and we never
 * auto-revoke.** A domain proven in August may have changed hands by March, so a
 * proof genuinely does decay — but expiring it automatically would take a LIVE
 * tenant's domain out of the partner's usable set at a moment nobody chose, and
 * the only thing that would actually break is the partner's ability to propose the
 * NEXT client. It would not, and could not, unpublish the tenants already served
 * from that zone: those are registry entries and Caddy site blocks the founder
 * owns (ADR-003/007), and this app cannot touch them. So an auto-revoke would
 * deliver all of the disruption and none of the protection.
 *
 * What staleness is FOR: the founder sees it on the partner's page and can ask,
 * and re-proving is one button away for the partner — the token never changes, so
 * the record they published years ago still satisfies it. Anyone who has since
 * lost the zone cannot re-prove, which is exactly the signal worth having.
 *
 * `now` is injected so the boundary is a test, not a race against the wall clock.
 */
export function verificationAge(verifiedAt: Date | null, now: Date): VerificationAge {
  if (!verifiedAt) return { verified: false, ageDays: null, stale: false };
  const ageDays = Math.floor((now.getTime() - verifiedAt.getTime()) / DAY_MS);
  return { verified: true, ageDays, stale: ageDays >= STALE_AFTER_DAYS };
}
