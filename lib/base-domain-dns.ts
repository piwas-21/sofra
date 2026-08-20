// The one network call in the partner-domain feature: resolve
// `_sofra-verify.<domain>` TXT and hand the raw answer to the pure matcher.
//
// Kept to itself, and kept this thin, for the same reason `lib/vies.ts` is separate
// from `lib/vies-result.ts`: the judgement is unit-testable and the transport is
// not, so the part that is easy to get wrong is the part that is measured. Nothing
// here decides anything — `txtMatchesToken` does.
//
// This is an outbound query on a user-supplied name, which is the reason the
// callers do two things before reaching it: `normalizeBaseDomain` refuses anything
// that is not a plausible PUBLIC hostname (no IP literals, no special-use TLDs, no
// credentials or ports), and the action rate-limits per partner. It resolves DNS
// only — no HTTP is ever made to the name — so there is no request to point at an
// internal address even if a zone answered with one.

import { Resolver } from "node:dns/promises";

/** A resolver answer, reduced to what the caller can act on. `notFound` covers both
 *  "no such name" and "name exists, no TXT at it": to a partner who has not published
 *  the record yet they are the same sentence, and telling them apart would only invite
 *  a second error string nobody can act on differently. */
export type TxtLookup =
  | { ok: true; records: string[][] }
  | { ok: false; reason: "notFound" | "lookupFailed" };

/** Per-query ceiling. A partner is waiting on this inside a server action, and a
 *  zone whose nameservers black-hole UDP would otherwise hold the request open for
 *  the platform's whole timeout. Two tries so one dropped packet is not a failure. */
const TIMEOUT_MS = 5_000;
const TRIES = 2;

/** Answers we will look at. A pathological zone can return hundreds of TXT records;
 *  the matcher is O(n) over them and there is no reason to walk more than this. */
const MAX_RECORDS = 50;

/** DNS error codes that mean "the record is not published", as opposed to "we could
 *  not ask". The distinction is what stops a resolver outage from being reported to a
 *  partner as a failed proof. */
const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export async function lookupVerificationTxt(name: string): Promise<TxtLookup> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: TRIES });
  try {
    const records = await resolver.resolveTxt(name);
    return { ok: true, records: records.slice(0, MAX_RECORDS) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code && NOT_FOUND_CODES.has(code)) return { ok: false, reason: "notFound" };
    // No hostname in the log line: it is a partner's own company domain, and §5.8
    // keeps customer-identifying values out of console output. The code is enough
    // to tell a resolver outage from a misconfiguration.
    console.error("base-domain: TXT lookup failed", code ?? "unknown");
    return { ok: false, reason: "lookupFailed" };
  }
}
