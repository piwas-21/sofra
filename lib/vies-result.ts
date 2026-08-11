// Interpreting a VIES response. (SOFRA-BILLING-IDENTITY-PLAN B2, §6b.)
//
// Split from lib/vies.ts — which owns the fetch — so the part that is easy to get
// WRONG is pure, and therefore unit-testable without a network. Every rule below
// was measured against the live API on 2026-08-11 while researching the plan;
// none of it is defensive guesswork.
//
// The one thing to understand before touching this file:
//
//   **A VIES response that says `valid: false` very often does NOT mean invalid.**
//
// The member state answers through a relay that fails in its own right, and every
// one of those failures is also serialized as `valid: false`. During the plan's
// research the French node returned MS_MAX_CONCURRENT_REQ on 5 of 8 calls — while
// the service's own check-status endpoint reported `FR: Available` — and a
// different French number resolved cleanly seconds later. A client that reads
// only the boolean rejects real customers whenever a member state is busy, and
// (worse) can silently retract a reverse charge that was substantiated correctly
// last quarter.
//
// So this module is tri-valued on purpose, and `UNAVAILABLE` is a first-class
// answer meaning "ask again later", never "no".

/** Mirrors the Prisma `VatStatus` enum for the three outcomes a check can yield. */
export type ViesStatus = "VALID" | "INVALID" | "UNAVAILABLE";

/**
 * The response shape, spanning BOTH endpoints on purpose:
 *   • `POST /check-vat-number` answers `valid`
 *   • `GET  /ms/{cc}/vat/{n}`   answers `isValid`
 * Reading only one of them is a silent always-UNAVAILABLE if the caller is ever
 * switched, so both are accepted here.
 */
export type ViesRawResponse = {
  valid?: boolean;
  isValid?: boolean;
  userError?: string | null;
  name?: string | null;
  address?: string | null;
  requestIdentifier?: string | null;
  requestDate?: string | null;
  // --- The SECOND error envelope ---
  // Measured 2026-08-11: when POST /check-vat-number fails it does not answer the
  // flat `{valid:false, userError:…}` shape at all. It answers
  //   {"actionSucceed": false, "errorWrappers": [{"error": "MS_MAX_CONCURRENT_REQ"}]}
  // with no `valid` key. Reading only `userError` therefore silently discarded the
  // reason on every POST failure — the outcome still fell safe (UNAVAILABLE, since
  // there was no verdict to read) but with `detail: null`, so the audit trail and
  // the operator both learned nothing, and a PERMANENT error arriving this way
  // would have been retried forever instead of recorded.
  actionSucceed?: boolean;
  errorWrappers?: ReadonlyArray<{ error?: string | null }> | null;
};

export type ViesOutcome = {
  status: ViesStatus;
  /** The consultation reference — audit evidence. Only ever set on a VALID answer
   *  that was requested WITH requester identification (see lib/vies.ts). */
  ref: string | null;
  /** Registered name/address as the member state holds them. Many states return
   *  these blank even for valid numbers (FR does not; DE does), so an empty name
   *  on a VALID answer is normal and must not be treated as a failure. */
  name: string | null;
  address: string | null;
  /** The raw `userError`, kept for the audit trail and for operator diagnosis. */
  detail: string | null;
};

/**
 * The ONLY `userError` values that are a verdict about the number itself.
 *
 * This is an allow-list of PERMANENT answers, and the direction is deliberate:
 * anything not named here — including an error code nobody has seen yet — is
 * treated as "could not check". The reverse (an allow-list of *transient* codes,
 * defaulting to invalid) is the shape this module was first written in, and it
 * re-armed the very failure the module exists to prevent: VIES publishes
 * time-window siblings of the measured throttle (`MS_MAX_CONCURRENT_REQ_TIME`,
 * `GLOBAL_MAX_CONCURRENT_REQ_TIME`) plus `IO_ERROR` and `TECHNICAL_ERROR`, and
 * every one of them would have been banked as "this customer's number is bad".
 *
 * The inversion made it visible: with a transient allow-list, ADDING evidence
 * that the relay failed (a named throttle error on an otherwise identical body)
 * flipped the verdict from UNAVAILABLE to INVALID.
 *
 * `INVALID_INPUT` belongs here because it means the number's SHAPE was rejected —
 * a real, permanent fact about that string, and not something retrying fixes.
 * (lib/vat-number.ts should have caught it long before VIES did.)
 */
const PERMANENT_ERRORS = new Set(["INVALID", "INVALID_INPUT"]);

/**
 * VIES fills unanswered identity fields with this placeholder rather than leaving
 * them blank — including on a perfectly ordinary negative.
 *
 * It is therefore NOT a tell for anything, and an earlier version of this module
 * treated it as one: "a genuine negative returns empty strings, an error returns
 * `---`". That premise came from the GET endpoint, and it is false for the POST
 * endpoint lib/vies.ts actually calls. Measured 2026-08-11, all HTTP 200, all
 * well-formed non-existent numbers:
 *
 *   DE, NL, IT  ->  {valid: false, name: "---", address: "---"}   (no userError)
 *
 * i.e. the shape the module was reading as "the relay failed, ask again" is the
 * ordinary way most member states say *not registered*. Left in use only by
 * `cleanField`, which is the honest job for it: turning "nothing here" into null.
 */
const PLACEHOLDER = "---";

/** `"---"` and `""` both mean "nothing here" to a caller; normalize to null. */
function cleanField(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" || s === PLACEHOLDER ? null : s;
}

/** The error VIES named, from EITHER envelope (see `ViesRawResponse`). Reading
 *  only one of them loses the reason on every failure of the other. */
function namedError(raw: ViesRawResponse): string | null {
  const flat = raw.userError?.trim();
  if (flat) return flat;
  for (const w of raw.errorWrappers ?? []) {
    const wrapped = w?.error?.trim();
    if (wrapped) return wrapped;
  }
  return null;
}

/**
 * Turn a raw VIES body into a decision.
 *
 * The number is declared INVALID by exactly one shape: an explicit `false` that
 * is either unexplained or explained by a PERMANENT code. Every other path — an
 * unknown error, a requester error, an unparseable body — lands on UNAVAILABLE,
 * because none of them is evidence about the customer.
 */
export function interpretViesResponse(raw: ViesRawResponse): ViesOutcome {
  const detail = namedError(raw);
  const name = cleanField(raw.name);
  const address = cleanField(raw.address);
  const unavailable = (): ViesOutcome => ({
    status: "UNAVAILABLE",
    ref: null,
    name: null,
    address: null,
    detail,
  });
  const invalid = (): ViesOutcome => ({ status: "INVALID", ref: null, name, address, detail });

  const valid = raw.valid ?? raw.isValid;

  if (valid === true) {
    return { status: "VALID", ref: cleanField(raw.requestIdentifier), name, address, detail };
  }

  // A NAMED error decides next, before the validity boolean is consulted — which
  // is what makes both envelopes behave identically, since the POST failure shape
  // carries an error and no `valid` key at all. It is a verdict only if the error
  // is a permanent one; this is the inverted default described on PERMANENT_ERRORS.
  if (detail) return PERMANENT_ERRORS.has(detail) ? invalid() : unavailable();

  // The API's OWN discriminator for "this call did not succeed", used instead of
  // guessing from the identity fields. Reached only when no error was named, so
  // there is nothing to classify — ask again.
  if (raw.actionSucceed === false) return unavailable();

  // No error named and no verdict: a body we do not understand. Fail-safe in the
  // same direction — an unparseable answer is not evidence a number is bad.
  if (valid !== false) return unavailable();

  // An explicit `false` with no error named and no failure flag: the member state
  // answered, and the answer is no. Deliberately NOT second-guessed by inspecting
  // `name`/`address` — see the note on PLACEHOLDER for why that heuristic
  // classified the ordinary DE/NL/IT negative as an outage and then retried it
  // forever, which is the exact failure this module exists to prevent.
  return invalid();
}
