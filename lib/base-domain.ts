// What counts as a partner's own base domain, before we ever look it up.
//
// A partner claims a zone they say is theirs (`solutioneva.com`), and every client
// they later put under it becomes `<slug>.solutioneva.com` — a hostname we issue a
// certificate for and serve their customers' traffic from. So this module is the
// first half of the security boundary and `base-domain-verification.ts` is the
// second: this one decides whether a string is a plausible public zone we are
// willing to CHASE, and the TXT proof decides whether they actually hold it.
//
// Pure — no DNS, no DB, no env — so every rejection below is a unit test rather
// than a live lookup, and so the same verdict is reached by the form, the action
// and any later caller.
//
// It is NOT a public-suffix list. A full PSL would be the correct tool and is
// deliberately not vendored for one field: what is here refuses the shapes that
// are wrong for a reason we can name (our own zones, special-use TLDs, IP
// literals, a bare registry suffix from the short list below), and everything it
// lets through still has to prove control over `_sofra-verify.<domain>` before it
// can be used for anything. An over-permissive syntax check costs nothing on its
// own; an over-permissive PROOF would cost a certificate for a name we do not own.

/** Why a candidate was refused. Each value is a `control.errors.baseDomain.*` key. */
export type BaseDomainRejection =
  | "empty"
  | "tooLong"
  | "notAHostname"
  | "singleLabel"
  | "ipAddress"
  | "reservedTld"
  | "publicSuffix"
  | "ourZone";

export type BaseDomainResult =
  | { ok: true; domain: string }
  | { ok: false; reason: BaseDomainRejection };

/** Zones SofraPiwas itself answers for. A partner claiming one of these — or a
 *  subdomain of one — would be claiming our own product's namespace, and the TXT
 *  proof would not even be an obstacle for anyone who can already reach our DNS.
 *  Refused by name rather than left to the proof, so the refusal is explicit and
 *  testable. `fooderist.com` is here because `staging.fooderist.com` is still ours
 *  until the cutover. */
const OUR_ZONES = ["sofrapiwas.com", "fooderist.com"] as const;

/** Special-use and reserved top-level names (RFC 2606 / 6761 / 8375 and the
 *  common private ones). None of them can hold a public certificate, so a base
 *  domain under one is a mistake we can catch before a partner publishes a TXT
 *  record that could never help them. */
const RESERVED_TLDS = new Set([
  "test",
  "example",
  "invalid",
  "localhost",
  "local",
  "internal",
  "home",
  "arpa",
  "lan",
  "corp",
  "onion",
  "alt",
]);

/** A deliberately SHORT list of multi-label registry suffixes, used only to refuse
 *  a candidate that IS one exactly (`co.uk`) — never to judge anything longer.
 *  Claiming a registry suffix is always a mistake; a real PSL would catch more of
 *  them, and the TXT proof catches the rest. */
const BARE_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "co.nz",
  "co.za",
  "co.jp",
  "com.au",
  "net.au",
  "com.br",
  "com.cn",
  "com.mx",
  "com.tr",
  "com.sg",
]);

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** ASCII TLDs are letters; an IDN one is punycode (`xn--p1ai`). Both are accepted;
 *  an all-digit last label is not, which is how `192.168.0.1` is refused. */
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/;

/**
 * Normalize and validate a base domain a partner typed.
 *
 * Forgiving about the shapes people actually paste — a scheme, a trailing slash,
 * a trailing dot, mixed case, surrounding spaces — and strict about everything
 * else. The returned `domain` is what gets stored, shown in the TXT instructions
 * and, later, concatenated with a slug: one canonical form, decided here, so no
 * caller has to lower-case or strip anything again.
 */
export function normalizeBaseDomain(raw: string): BaseDomainResult {
  let value = raw.trim().toLowerCase();
  // A pasted address, reduced to its host. Done before the character check so the
  // common paste is accepted; anything still carrying a path, a port, credentials
  // or whitespace after this is refused rather than silently truncated further.
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/\/+$/, "");
  // A trailing dot is the fully-qualified form of the same name.
  value = value.replace(/\.$/, "");

  if (!value) return { ok: false, reason: "empty" };
  // 253 is the maximum length of a presentation-format domain name.
  if (value.length > 253) return { ok: false, reason: "tooLong" };
  if (/[^a-z0-9.-]/.test(value)) return { ok: false, reason: "notAHostname" };

  const labels = value.split(".");
  if (labels.length < 2) return { ok: false, reason: "singleLabel" };
  if (labels.some((l) => l.length === 0 || l.length > 63 || !LABEL.test(l))) {
    return { ok: false, reason: "notAHostname" };
  }

  const tld = labels[labels.length - 1];
  // Checked before the TLD grammar so a dotted-quad gets the message that names
  // it, rather than the generic one about the last label.
  if (labels.every((l) => /^\d+$/.test(l))) return { ok: false, reason: "ipAddress" };
  if (!TLD.test(tld)) return { ok: false, reason: "notAHostname" };
  if (RESERVED_TLDS.has(tld)) return { ok: false, reason: "reservedTld" };
  if (BARE_PUBLIC_SUFFIXES.has(value)) return { ok: false, reason: "publicSuffix" };
  if (OUR_ZONES.some((zone) => value === zone || value.endsWith(`.${zone}`))) {
    return { ok: false, reason: "ourZone" };
  }

  return { ok: true, domain: value };
}

/**
 * The hostname a tenant would get under this base domain.
 *
 * Here rather than inline at the two call sites (the partner's chooser and the
 * registry entry the founder emits) because those two must never disagree: the
 * partner publishes an A record for the name this returns, and the certificate is
 * issued for the name the registry carries. One function, one answer.
 */
export function tenantHostname(slug: string, baseDomain: string): string {
  return `${slug}.${baseDomain}`;
}
