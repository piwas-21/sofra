import { describe, expect, it } from "vitest";
import { interpretViesResponse, type ViesOutcome } from "@/lib/vies-result";
import { isRequesterError, isRetryable } from "@/lib/vies-retry";

const outcome = (over: Partial<ViesOutcome> = {}): ViesOutcome => ({
  status: "UNAVAILABLE",
  ref: null,
  name: null,
  address: null,
  detail: null,
  ...over,
});

// The bodies below are VERBATIM shapes measured against the live VIES API on
// 2026-08-11 while researching SOFRA-BILLING-IDENTITY-PLAN §2b. They are the
// reason this module exists, so they are pinned rather than paraphrased.

describe("interpretViesResponse — a busy member state is NOT an invalid number", () => {
  it("reads MS_MAX_CONCURRENT_REQ as UNAVAILABLE despite isValid:false", () => {
    // The whole point. The French node returned this on 5 of 8 calls while the
    // service reported itself Available. Read as INVALID, it rejects a real
    // customer — or silently retracts a reverse charge substantiated last quarter.
    expect(
      interpretViesResponse({
        isValid: false,
        userError: "MS_MAX_CONCURRENT_REQ",
        name: "---",
        address: "---",
      }),
    ).toMatchObject({ status: "UNAVAILABLE", detail: "MS_MAX_CONCURRENT_REQ" });
  });

  it("treats every transport-family error the same way", () => {
    for (const err of [
      "GLOBAL_MAX_CONCURRENT_REQ",
      "MS_UNAVAILABLE",
      "SERVICE_UNAVAILABLE",
      "SERVER_BUSY",
      "TIMEOUT",
      "IP_BLOCKED",
      "VAT_BLOCKED",
    ]) {
      expect(interpretViesResponse({ valid: false, userError: err }).status, err).toBe(
        "UNAVAILABLE",
      );
    }
  });

  it("treats an error code nobody has seen before as UNAVAILABLE, not INVALID", () => {
    // The inverted default. A closed allow-list of *transient* codes re-arms the
    // very failure this module prevents: VIES publishes time-window siblings of
    // the measured throttle, and each would otherwise be banked as "this
    // customer's number is bad".
    for (const err of [
      "MS_MAX_CONCURRENT_REQ_TIME",
      "GLOBAL_MAX_CONCURRENT_REQ_TIME",
      "IO_ERROR",
      "TECHNICAL_ERROR",
      "SOMETHING_VIES_ADDS_IN_2030",
    ]) {
      expect(interpretViesResponse({ valid: false, userError: err }).status, err).toBe(
        "UNAVAILABLE",
      );
    }
  });

  it("never lets ADDING evidence of a relay failure flip the verdict to INVALID", () => {
    // The sharpest statement of the bug this replaced: a named throttle on an
    // otherwise ordinary negative must not make the answer MORE confident.
    expect(
      interpretViesResponse({
        valid: false,
        name: "---",
        address: "---",
        userError: "MS_MAX_CONCURRENT_REQ_TIME",
      }).status,
    ).toBe("UNAVAILABLE");
  });

  it("does treat the two PERMANENT codes as a real verdict", () => {
    // INVALID is what the GET endpoint returns for a genuine negative;
    // INVALID_INPUT means the shape was rejected. Neither improves on retry.
    expect(interpretViesResponse({ valid: false, userError: "INVALID" }).status).toBe("INVALID");
    expect(interpretViesResponse({ valid: false, userError: "INVALID_INPUT" }).status).toBe(
      "INVALID",
    );
  });
});

describe("interpretViesResponse — the POST endpoint's SECOND error envelope", () => {
  // Measured verbatim 2026-08-11: this, not the flat `userError` shape, is what
  // POST /check-vat-number returns when it fails. There is no `valid` key at all.
  const wrapped = {
    actionSucceed: false,
    errorWrappers: [{ error: "MS_MAX_CONCURRENT_REQ" }],
  };

  it("reads the error out of errorWrappers, not just userError", () => {
    // Before this, the outcome still fell safe (UNAVAILABLE — there was no verdict
    // to misread) but carried `detail: null`, so nothing recorded WHY. The audit
    // trail and the operator both learned nothing on every POST failure.
    expect(interpretViesResponse(wrapped)).toMatchObject({
      status: "UNAVAILABLE",
      detail: "MS_MAX_CONCURRENT_REQ",
    });
  });

  it("retries it, because a detail-less unavailable and this one are the same event", () => {
    expect(isRetryable(interpretViesResponse(wrapped))).toBe(true);
  });

  it("still records a PERMANENT error arriving through the wrapper as a verdict", () => {
    // The case that would otherwise be retried forever instead of settled.
    expect(
      interpretViesResponse({ actionSucceed: false, errorWrappers: [{ error: "INVALID_INPUT" }] }),
    ).toMatchObject({ status: "INVALID", detail: "INVALID_INPUT" });
  });

  it("prefers the flat userError when a body somehow carries both", () => {
    expect(
      interpretViesResponse({
        valid: false,
        userError: "INVALID",
        errorWrappers: [{ error: "MS_MAX_CONCURRENT_REQ" }],
      }).detail,
    ).toBe("INVALID");
  });

  it("survives an empty or malformed wrapper list without inventing an error", () => {
    expect(interpretViesResponse({ errorWrappers: [] }).detail).toBeNull();
    expect(interpretViesResponse({ errorWrappers: null }).detail).toBeNull();
    expect(interpretViesResponse({ errorWrappers: [{ error: "  " }, { error: "IO_ERROR" }] }).detail).toBe(
      "IO_ERROR",
    );
  });
});

describe("interpretViesResponse — our own credentials are not a customer verdict", () => {
  it("reads INVALID_REQUESTER_INFO as UNAVAILABLE", () => {
    // VIES rejected OUR requester number. It says nothing about the customer, and
    // booking it as one would let a single bad SOFRA_VAT_NUMBER mark EVERY
    // customer INVALID — overwriting statuses validated correctly months ago.
    for (const err of ["INVALID_REQUESTER_INFO", "MS_INVALID_REQUESTER_INFO"]) {
      expect(isRequesterError(err), err).toBe(true);
      expect(interpretViesResponse({ valid: false, userError: err }).status, err).toBe(
        "UNAVAILABLE",
      );
    }
  });

  it("does not retry a requester error — the same credentials get the same answer", () => {
    expect(isRetryable(outcome({ detail: "INVALID_REQUESTER_INFO" }))).toBe(false);
  });
});

describe("isRetryable", () => {
  it("retries the throttles and unknown errors", () => {
    expect(isRetryable(outcome({ detail: "MS_MAX_CONCURRENT_REQ" }))).toBe(true);
    expect(isRetryable(outcome({ detail: "SOMETHING_NEW" }))).toBe(true);
  });

  it("retries timeouts and connection failures — the class the budget was written for", () => {
    // These were unreachable while the predicate keyed on userError names alone:
    // a 12s timeout or a dropped connection got exactly one attempt.
    for (const detail of ["TimeoutError", "AbortError", "TypeError", "FETCH_FAILED"]) {
      expect(isRetryable(outcome({ detail })), detail).toBe(true);
    }
  });

  it("retries relay 429 and 5xx, but not a 4xx we caused", () => {
    expect(isRetryable(outcome({ detail: "HTTP_429" }))).toBe(true);
    expect(isRetryable(outcome({ detail: "HTTP_503" }))).toBe(true);
    expect(isRetryable(outcome({ detail: "HTTP_500" }))).toBe(true);
    // Our request was malformed; it will not become well-formed on attempt two.
    expect(isRetryable(outcome({ detail: "HTTP_400" }))).toBe(false);
    expect(isRetryable(outcome({ detail: "HTTP_404" }))).toBe(false);
  });

  it("never retries a settled answer", () => {
    expect(isRetryable(outcome({ status: "VALID" }))).toBe(false);
    expect(isRetryable(outcome({ status: "INVALID" }))).toBe(false);
    // Even if a settled answer somehow carries a retryable-looking detail.
    expect(isRetryable(outcome({ status: "INVALID", detail: "HTTP_503" }))).toBe(false);
  });

  it("retries an unavailable answer with no detail at all", () => {
    expect(isRetryable(outcome())).toBe(true);
  });
});

describe("interpretViesResponse — real verdicts", () => {
  it("reads the measured VALID answer, keeping the consultation reference", () => {
    expect(
      interpretViesResponse({
        valid: true,
        requestIdentifier: "WAPIAAAAZ_xyEjhz",
        name: "SA SODIMAS",
        address: "11 RUE AMPERE\n26600 PONT DE L ISERE",
      }),
    ).toEqual({
      status: "VALID",
      ref: "WAPIAAAAZ_xyEjhz",
      name: "SA SODIMAS",
      address: "11 RUE AMPERE\n26600 PONT DE L ISERE",
      detail: null,
    });
  });

  it("reads the partner's measured INVALID answer — empty strings, no userError", () => {
    // The genuine member-state negative: `valid:false` with EMPTY identity fields.
    expect(
      interpretViesResponse({ valid: false, name: "", address: "", requestDate: "2026-08-11" }),
    ).toMatchObject({ status: "INVALID", ref: null, name: null, address: null });
  });

  it("reads the GET endpoint's `isValid` as well as the POST endpoint's `valid`", () => {
    // Both are accepted so switching endpoints cannot silently make every check
    // UNAVAILABLE.
    expect(interpretViesResponse({ isValid: true }).status).toBe("VALID");
    expect(interpretViesResponse({ isValid: false, name: "", address: "" }).status).toBe("INVALID");
  });

  it("keeps a VALID answer valid when the member state returns no name", () => {
    // Several states (DE among them) answer valid with blank identity fields.
    // Treating that as a failure would reject them all.
    expect(interpretViesResponse({ valid: true, name: "---", address: "---" })).toMatchObject({
      status: "VALID",
      name: null,
      address: null,
    });
  });

  it("returns ref:null when the check was made without requester identification", () => {
    // Measured: the same call without requester details returns "" for the
    // identifier. Null here is what tells the invoice path the check is unevidenced.
    expect(interpretViesResponse({ valid: true, requestIdentifier: "" }).ref).toBeNull();
  });
});

describe("interpretViesResponse — fail-safe on anything unclear", () => {
  it("treats a body with no validity field at all as UNAVAILABLE, not INVALID", () => {
    expect(interpretViesResponse({}).status).toBe("UNAVAILABLE");
    expect(interpretViesResponse({ name: "x" }).status).toBe("UNAVAILABLE");
  });

  it("reads the API's OWN failure flag rather than guessing from identity fields", () => {
    // actionSucceed:false with nothing named — the call did not succeed, so there
    // is no verdict to record.
    expect(interpretViesResponse({ actionSucceed: false }).status).toBe("UNAVAILABLE");
  });

  it("does NOT treat the `---` placeholder as a failure tell — it is an ordinary negative", () => {
    // The premise this replaced said a genuine negative returns empty strings and
    // an error returns "---". That is true of the GET endpoint and FALSE of the
    // POST endpoint we call. Measured 2026-08-11, HTTP 200, well-formed
    // non-existent numbers: DE, NL and IT ALL answer {valid:false, "---", "---"}.
    // Read as an outage, every genuine rejection across most of the EU became
    // UNAVAILABLE, was retried three times, and then sat in the re-check backlog
    // forever — while the customer was told "we could not check" instead of "that
    // number is not registered".
    for (const cc of ["DE", "NL", "IT"]) {
      expect(
        interpretViesResponse({ valid: false, name: "---", address: "---" }).status,
        cc,
      ).toBe("INVALID");
    }
  });

  it("normalizes whitespace-only fields to null rather than empty strings", () => {
    expect(interpretViesResponse({ valid: true, name: "  ", address: " " })).toMatchObject({
      name: null,
      address: null,
    });
  });

  it("carries userError through as detail for the audit trail", () => {
    expect(interpretViesResponse({ valid: true, userError: "VALID" }).detail).toBe("VALID");
  });
});
