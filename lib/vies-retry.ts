// Should we ask VIES again? (SOFRA-BILLING-IDENTITY-PLAN B2.)
//
// Split from lib/vies-result.ts — which decides WHAT VIES said — because this
// decides whether the answer is worth a second attempt, and the two questions
// have different right answers. Pure, so both are unit-testable without a network.

import type { ViesOutcome } from "@/lib/vies-result";

/**
 * Errors about OUR OWN requester credentials, not about the number being checked.
 *
 * `INVALID_REQUESTER_INFO` means VIES rejected the VAT number we identified
 * ourselves with (lib/vies.ts sends one to obtain a consultation reference). It
 * says nothing whatsoever about the customer. `interpretViesResponse` already
 * refuses to read it as a verdict — this set exists so the retry loop does not
 * spend its budget re-sending the same rejected credentials, and so an operator
 * alarm can be told apart from a busy member state.
 */
const REQUESTER_ERRORS = new Set(["INVALID_REQUESTER_INFO", "MS_INVALID_REQUESTER_INFO"]);

/** Our own credentials were rejected — an operator alarm, never a customer verdict. */
export function isRequesterError(userError: string | null | undefined): boolean {
  return !!userError && REQUESTER_ERRORS.has(userError);
}

/**
 * Would another attempt plausibly get a different answer?
 *
 * The first version of this predicate keyed on the transport-error NAMES alone,
 * which made the retry loop dead for timeouts, connection failures and relay 5xx
 * — the details those produce (`HTTP_503`, `TimeoutError`) are not `userError`
 * strings and matched nothing. The asymmetry was backwards as well: a
 * persistently busy member state got three attempts while a one-off blip got one.
 *
 * So the rule is now stated the other way round — everything unresolved is worth
 * retrying EXCEPT the cases where a second attempt provably cannot help.
 */
export function isRetryable(outcome: ViesOutcome): boolean {
  if (outcome.status !== "UNAVAILABLE") return false;
  const detail = outcome.detail ?? "";
  // Retrying with the same rejected credentials only reproduces the rejection.
  if (isRequesterError(detail)) return false;
  const http = /^HTTP_(\d{3})$/.exec(detail);
  // Our own malformed request (4xx) will not become well-formed on a second try;
  // 429 and 5xx are the relay saying "later", which is what retry is for.
  if (http) {
    const status = Number(http[1]);
    return status === 429 || status >= 500;
  }
  return true;
}
