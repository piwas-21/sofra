// Keeping recipient addresses OUT of the logs (CLAUDE.md §5.8, EMAIL-SPEC-CONTROL-PLANE G15).
//
// `lib/email.ts` used to write `to=${opts.to}` on both of its refusal paths, so
// every send made without a key or without a verified sender put a customer's
// address into the container log — the one place this repo says PII may not go.
// The file-length checker's PII heuristic did not catch it because that rule
// looks for an email-SHAPED literal on a `console.*` line, and an interpolated
// variable has no shape until runtime.
//
// What replaces the address is a TAG: a short digest that is stable within a
// process, so two failures for the same recipient are still recognisably the
// same recipient, and useless as an address.
//
// The salt is why this is not just "hash the email and call it anonymous". An
// email address is a low-entropy, guessable value: an unsalted digest of one is
// reversible by anyone holding a list of addresses, which is what a leaked log
// would be handed to. `LOG_HASH_SALT` pins the tag across restarts and
// containers when an operator wants that; unset, a per-process random salt is
// generated, and the tags are then correlatable only within one container's
// lifetime — deliberately the safer default, because the common case (reading
// one container's log after a failed send) needs nothing more.
//
// It is pseudonymisation, not anonymisation, and the doc comment says so on
// purpose: with the salt in hand the tag is reversible again. The claim is
// narrow and true — an address is no longer sitting in the log.

import { createHash, randomBytes } from "node:crypto";

/** Emitted instead of a tag when there is no address at all. A digest here would
 *  assert a recipient that never existed. */
export const NO_RECIPIENT = "(none)";

/**
 * The scan is over WHITESPACE-SEPARATED TOKENS, and the address test is written
 * in code rather than in the pattern. That is the whole design of this half.
 *
 * A regex that describes an address — even `[^\s@]+@[^\s@]+` — backtracks
 * quadratically on a long run containing no `@`, because the leading class
 * consumes the whole run and then gives back one character at a time, from every
 * starting offset. This regex is pointed at text a THIRD PARTY controls (a
 * provider's error body), so that is not an academic property: measured at ~1.9s
 * for a 100 KB token, and provider bodies have no size limit we set.
 *
 * `\S+` cannot backtrack (nothing follows it), so the scan is linear and the
 * judgement happens on a bounded token.
 */
const TOKEN = /\S+/g;
/** Wrapping punctuation a provider is likely to quote an address inside. */
const LEADING_PUNCTUATION = /^[<("'[]+/;
const TRAILING_PUNCTUATION = /[>)"'\],;:.]+$/;
/** A dotted TLD is what separates an address from `@mention` noise. */
const LOOKS_LIKE_ADDRESS = /\.[a-z]{2,}$/i;

let processSalt: string | null = null;

function salt(): string {
  const configured = process.env.LOG_HASH_SALT;
  if (configured) return configured;
  // Lazily generated, once, and never logged. Not a secret worth managing — its
  // only job is to make the digests in one log file non-reversible.
  processSalt ??= randomBytes(16).toString("hex");
  return processSalt;
}

/**
 * A stable, non-address stand-in for one recipient, e.g. `#3f1a9c22b0`.
 *
 * Normalised (trimmed + lower-cased) so `Owner@Example.com` and
 * `owner@example.com` tag identically — an operator comparing two log lines is
 * asking about the person, not about the capitalisation.
 */
export function recipientTag(address: string | null | undefined): string {
  const normalized = (address ?? "").trim().toLowerCase();
  if (!normalized) return NO_RECIPIENT;
  // Not a nested template literal, on purpose (Sonar S4624): the digest is its
  // own step, which is also where anyone reading this looks first.
  const digest = createHash("sha256").update(`${salt()}:${normalized}`).digest("hex");
  return `#${digest.slice(0, 10)}`;
}

/**
 * The same substitution, applied to text we did not write.
 *
 * Resend's error bodies quote the recipient back at us — the sandbox-sender 403
 * is literally *"You can only send testing emails to your own email address
 * (...)"* — so logging a provider response verbatim reintroduces exactly what
 * `recipientTag` removes, from a direction nobody thinks to check.
 */
export function redactAddresses(text: string): string {
  return text.replace(TOKEN, (token) => {
    const lead = LEADING_PUNCTUATION.exec(token)?.[0] ?? "";
    const withoutLead = token.slice(lead.length);
    const trail = TRAILING_PUNCTUATION.exec(withoutLead)?.[0] ?? "";
    const core = withoutLead.slice(0, withoutLead.length - trail.length);
    // Exactly one `@`, with something on each side, and a dotted TLD. Anything
    // else is left alone: turning `@here` — or a token carrying two `@` — into a
    // digest would make the line harder to read and buy no privacy at all.
    const at = core.indexOf("@");
    if (at <= 0 || at === core.length - 1) return token;
    if (core.indexOf("@", at + 1) !== -1) return token;
    if (!LOOKS_LIKE_ADDRESS.test(core)) return token;
    return `${lead}${recipientTag(core)}${trail}`;
  });
}
