// Does the record actually resolve, and does it point at us?
//
// The companion to `tenant-dns-record.ts`: that one says what MUST exist, this one
// reports what DOES. Split for the same reason `base-domain-dns.ts` is split from
// `base-domain-verification.ts` — the judgement is pure and testable, the transport
// is neither, so the fallible half is kept small enough to read in one go.
//
// Why it is worth a network call on a page render: "here is the record" and "here is
// the record, and we cannot see it yet" are different sentences to a partner. The
// first is documentation; only the second tells him the thing he has not done. The
// live client this was built for had a perfectly correct instruction available to us
// and an absent record, and nobody could see the gap without a shell.
//
// Safety: A-lookups only, on hostnames that come from the REGISTRY (a file only the
// founder can merge into), never from the request. No HTTP is ever made to the name,
// so a zone that answers with an internal address gets a red line in the UI, not a
// request from our server.

import { Resolver } from "node:dns/promises";

/** A partner is waiting on this inside a page render, so it must fail fast. Two
 *  tries so one dropped packet is not reported to him as a missing record. */
const TIMEOUT_MS = 3_000;
const TRIES = 2;

/** "The name does not exist" and "it exists with no A record" are the same news to
 *  someone who has not published it yet. */
const MISSING_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export type DnsRecordState =
  /** Resolves, and to this box: nothing left to do. */
  | { status: "ok"; addresses: string[] }
  /** Resolves somewhere else — a typo, or an old record from another host. */
  | { status: "elsewhere"; addresses: string[] }
  /** Not published yet. The actionable one, and the reason this module exists. */
  | { status: "missing" }
  /** Resolver trouble, or we do not know our own address. Never reported as
   *  "missing": telling a partner his correct record is absent is worse than
   *  telling him we could not check. */
  | { status: "unknown" };

export async function checkDnsRecord(host: string, expectedIp?: string): Promise<DnsRecordState> {
  if (!expectedIp) return { status: "unknown" };
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: TRIES });
  try {
    const addresses = await resolver.resolve4(host);
    if (addresses.length === 0) return { status: "missing" };
    return addresses.includes(expectedIp)
      ? { status: "ok", addresses }
      : { status: "elsewhere", addresses };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code && MISSING_CODES.has(code)) return { status: "missing" };
    // No hostname in the log line — it is a customer's domain, and §5.8 keeps
    // customer-identifying values out of console output.
    console.error("tenant-dns: A lookup failed", code ?? "unknown");
    return { status: "unknown" };
  }
}
