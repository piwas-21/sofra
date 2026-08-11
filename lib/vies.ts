// VIES VAT-number checking — the network half. (SOFRA-BILLING-IDENTITY-PLAN B2.)
//
// Thin by design: fetch, hand the body to `interpretViesResponse`, retry the
// answers that mean "busy". All the judgement lives in lib/vies-result.ts, which
// is pure and unit-tested; all the shape checking lives in lib/vat-number.ts.
// Mirrors the fetch-based, SDK-free pattern of lib/mollie.ts and lib/email.ts.
//
// Two decisions worth keeping:
//
// 1. **The POST endpoint, with requester identification.** Measured 2026-08-11:
//    POST /check-vat-number carrying `requesterMemberStateCode` + `requesterNumber`
//    returns `requestIdentifier: "WAPIAAAAZ_xyEjhz"`; the identical call without
//    them returns `""`, and the plain `GET /ms/{cc}/vat/{n}` form can never return
//    one at all. That identifier is the consultation reference — the evidence that
//    the check happened, on that date, by us. A check without it is unverifiable
//    at audit, which is most of the value gone.
//
// 2. **This function does not throw for a negative or an outage.** A failed check
//    is a normal business state (`UNAVAILABLE`), not an exception. Callers store
//    it and move on; the re-check job drains it later.

import { checkVatFormat } from "@/lib/vat-number";
import { interpretViesResponse, type ViesOutcome } from "@/lib/vies-result";
import { isRetryable } from "@/lib/vies-retry";

const VIES_API = "https://ec.europa.eu/taxation_customs/vies/rest-api";

/** Bounded, because a member state that is busy now is usually busy for a while
 *  and a form submission cannot wait. The scheduled re-check is what actually
 *  resolves a persistent UNAVAILABLE — this only smooths a momentary blip. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1200;
const TIMEOUT_MS = 12_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sofra's own VAT identification number, used to identify us as the requester so
 * VIES issues a consultation reference.
 *
 * **Validated, not merely normalized** — and that is load-bearing. VIES answers
 * `INVALID_REQUESTER_INFO` when it rejects OUR number, and that error is about us
 * rather than the customer. Sending a malformed one (a value missing its `NL`
 * prefix splits into garbage at `slice(0,2)`/`slice(2)`) would put every check
 * for every customer on a path that must not be mistaken for a verdict. Sending
 * NO requester block is strictly better: the fallback (`ref: null`) is already a
 * defined, honest state meaning "checked, but unevidenced".
 *
 * Unset is not neutral either — see `.env.example`.
 */
export function requesterVatNumber(): string | null {
  const raw = process.env.SOFRA_VAT_NUMBER?.trim();
  if (!raw) return null;
  const verdict = checkVatFormat(raw);
  if (!verdict.ok) {
    // No value logged: this is the company's own identifier, and §5.8 keeps
    // identifiers out of console output. The operator needs the fact, not the number.
    console.warn(
      `SOFRA_VAT_NUMBER is not a well-formed EU VAT number (${verdict.reason}) — ` +
        "VIES checks will carry no consultation reference.",
    );
    return null;
  }
  return verdict.country + verdict.national;
}

async function postCheck(
  countryCode: string,
  vatNumber: string,
  requester: string | null,
  signal: AbortSignal,
): Promise<ViesOutcome> {
  const res = await fetch(`${VIES_API}/check-vat-number`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      countryCode,
      vatNumber,
      // Both or neither: VIES ignores a half-supplied requester and silently
      // returns an empty reference, which would look like a successful check.
      ...(requester
        ? {
            requesterMemberStateCode: requester.slice(0, 2),
            requesterNumber: requester.slice(2),
          }
        : {}),
    }),
    signal,
  });

  if (!res.ok) {
    // 4xx/5xx from the relay itself. Same class as a busy member state: no
    // evidence about the number, so it must not read as a rejection.
    return {
      status: "UNAVAILABLE",
      ref: null,
      name: null,
      address: null,
      detail: `HTTP_${res.status}`,
    };
  }
  return interpretViesResponse(await res.json());
}

/**
 * Check a VAT number against VIES.
 *
 * Never throws. Returns `INVALID` without a network call when the number cannot
 * be one (wrong shape, unknown country) — the plan's §2b trap, where a bare
 * 9-digit French SIREN gets an `INVALID` from VIES that is indistinguishable from
 * a real negative. Catching it by shape means the stored verdict is about the
 * NUMBER rather than about how we asked.
 *
 * Note for anything rendering this to a person: `detail` carries WHICH refusal it
 * was, and `FORMAT_UNKNOWNCOUNTRY` is not really "invalid" — a Swiss `CHE…` or a
 * British `GB…` is a perfectly good national number that VIES simply does not
 * cover. Say "not an EU VAT number" for that one; "invalid" would be wrong and
 * would send a non-EU customer hunting for a mistake they have not made.
 */
export async function checkVatNumber(raw: string): Promise<ViesOutcome> {
  const format = checkVatFormat(raw);
  if (!format.ok) {
    return {
      status: "INVALID",
      ref: null,
      name: null,
      address: null,
      detail: `FORMAT_${format.reason.toUpperCase()}`,
    };
  }

  let last: ViesOutcome = {
    status: "UNAVAILABLE",
    ref: null,
    name: null,
    address: null,
    detail: "NOT_ATTEMPTED",
  };
  // Resolved once, outside the loop: it reads the environment and may warn, and
  // there is no reason for a misconfigured value to log three times per check.
  const requester = requesterVatNumber();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    try {
      last = await postCheck(format.country, format.national, requester, timeout);
    } catch (e) {
      // A rejected fetch (DNS, connect, abort) is an outage, not a verdict.
      last = {
        status: "UNAVAILABLE",
        ref: null,
        name: null,
        address: null,
        detail: e instanceof Error ? e.name : "FETCH_FAILED",
      };
    }
    // A VALID or INVALID answer is final. Among the unavailable ones, only those
    // another attempt could plausibly change are repeated — which now includes
    // the timeouts, connection failures and relay 5xx that the retry budget was
    // written for and previously never saw (see `isRetryable`).
    if (!isRetryable(last)) return last;
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }
  return last;
}
