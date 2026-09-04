// Verifies Stripe's `Stripe-Signature` webhook header.
//
// Header format: `t=<unix-seconds>,v1=<hex-hmac-sha256>[,v1=<hex-hmac-sha256>]`.
// A SECOND `v1` occurs during a webhook secret ROTATION — Stripe signs with
// both the old and new secret for the overlap window — so this accepts when
// ANY `v1` value matches, not only the first.
//
// Pure and clock-free by design, same reason as lib/trial.ts: `nowSeconds` is
// always passed in, never read from `Date.now()` inside here, so a test can
// pin the clock and assert the replay window deterministically instead of
// racing a live one.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Stripe's own webhook library defaults to this tolerance. Named so it reads
// as a stated policy at the call site, not a mystery literal.
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Constant-time hex comparison. Both sides are SHA-256'd to a fixed 32 bytes
 * first — same trick as lib/cron-auth.ts — so a `v1` value of the wrong
 * length can never make `timingSafeEqual` throw (which would 500 instead of
 * "signature invalid" and leak the real digest's length via the error).
 */
function safeEqualHex(a: string, b: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

/**
 * True iff `header` is a well-formed, unexpired `Stripe-Signature` whose
 * signed payload — `` `${t}.${rawBody}` `` — matches an HMAC-SHA256 of that
 * payload under `secret` for at least one `v1` candidate.
 *
 * `rawBody` MUST be the exact bytes Stripe sent (as text, not a re-serialized
 * JSON.parse output) — the signature is computed over those bytes, so a
 * round-tripped body would fail verification even when genuine.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSeconds: number,
): boolean {
  let t: string | undefined;
  const v1s: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && value) t = value;
    else if (key === "v1" && value) v1s.push(value);
  }
  if (!t || v1s.length === 0) return false;

  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return false;
  // Both directions: a header from the future is as suspect as a stale one,
  // and this is a REPLAY guard, not merely an expiry check.
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1s.some((v1) => safeEqualHex(v1, expected));
}
