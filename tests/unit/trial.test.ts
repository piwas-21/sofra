import { describe, expect, it } from "vitest";
import {
  addMonthsClampedUtc,
  defaultTrialEnd,
  endOfUtcDay,
  extendTrialVerdict,
  isTrialActive,
  MAX_TRIAL_MONTHS_AHEAD,
  trialEndForNewPlan,
  trialView,
} from "@/lib/trial";

const iso = (d: Date) => d.toISOString();

describe("addMonthsClampedUtc (the month-end rule)", () => {
  it("keeps the day of month when the target month has it", () => {
    expect(iso(addMonthsClampedUtc(new Date("2026-08-19T09:14:00.000Z"), 1))).toBe(
      "2026-09-19T09:14:00.000Z",
    );
  });

  it("CLAMPS to the last day of the target month instead of overflowing", () => {
    // The rule this pins: 31 January + 1 month = 28 February, NOT 3 March.
    // `setUTCMonth` alone rolls forward, which would hand out three free days
    // nobody decided to give, on a date the reader did not expect.
    expect(iso(addMonthsClampedUtc(new Date("2026-01-31T00:00:00.000Z"), 1))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(iso(addMonthsClampedUtc(new Date("2026-03-31T00:00:00.000Z"), 1))).toBe(
      "2026-04-30T00:00:00.000Z",
    );
  });

  it("knows about leap years", () => {
    expect(iso(addMonthsClampedUtc(new Date("2028-01-31T00:00:00.000Z"), 1))).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("crosses the year boundary", () => {
    expect(iso(addMonthsClampedUtc(new Date("2026-12-15T00:00:00.000Z"), 1))).toBe(
      "2027-01-15T00:00:00.000Z",
    );
    expect(iso(addMonthsClampedUtc(new Date("2026-08-19T00:00:00.000Z"), 12))).toBe(
      "2027-08-19T00:00:00.000Z",
    );
  });
});

describe("endOfUtcDay", () => {
  it("takes a date to the last instant of its UTC day", () => {
    expect(iso(endOfUtcDay(new Date("2026-09-19T09:14:23.123Z")))).toBe(
      "2026-09-19T23:59:59.999Z",
    );
  });
});

describe("defaultTrialEnd / trialEndForNewPlan (the policy)", () => {
  it("is one month out, ending at the END of that day", () => {
    // The day named is free in full: a plan defined at 09:14 must not start asking
    // for money at 09:14 on a date the partner was shown as free.
    expect(iso(defaultTrialEnd(new Date("2026-08-19T09:14:00.000Z")))).toBe(
      "2026-09-19T23:59:59.999Z",
    );
  });

  it("clamps the month end here too", () => {
    expect(iso(defaultTrialEnd(new Date("2026-01-31T22:00:00.000Z")))).toBe(
      "2026-02-28T23:59:59.999Z",
    );
  });

  it("grants a trial to a RESELLER plan and none to a self-serve owner plan", () => {
    const now = new Date("2026-08-19T09:14:00.000Z");
    expect(iso(trialEndForNewPlan({ resellerPaid: true, now })!)).toBe(
      "2026-09-19T23:59:59.999Z",
    );
    // O2's pay-before-provision gate is the abuse defence for anonymous signups —
    // a trial there would invert it.
    expect(trialEndForNewPlan({ resellerPaid: false, now })).toBeNull();
  });
});

describe("trialView", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  it("reads a null column as no trial — payable now", () => {
    expect(trialView(null, now)).toEqual({ kind: "none" });
    expect(trialView(undefined, now)).toEqual({ kind: "none" });
    expect(isTrialActive(null, now)).toBe(false);
  });

  it("ignores an unparseable date rather than granting an infinite trial", () => {
    expect(trialView(new Date("nonsense"), now)).toEqual({ kind: "none" });
  });

  it("counts the last partial day as one day left", () => {
    const endsAt = new Date("2026-08-19T23:59:59.999Z");
    expect(trialView(endsAt, now)).toEqual({ kind: "active", endsAt, daysLeft: 1 });
    expect(isTrialActive(endsAt, now)).toBe(true);
  });

  it("counts a month's trial in days", () => {
    const endsAt = new Date("2026-09-19T23:59:59.999Z");
    const view = trialView(endsAt, now);
    expect(view.kind).toBe("active");
    expect(view.kind === "active" && view.daysLeft).toBe(32);
  });

  it("is expired at and after the end instant", () => {
    const endsAt = new Date("2026-08-19T12:00:00.000Z");
    expect(trialView(endsAt, now)).toEqual({ kind: "expired", endsAt });
    expect(trialView(new Date("2026-07-19T23:59:59.999Z"), now).kind).toBe("expired");
    expect(isTrialActive(endsAt, now)).toBe(false);
  });
});

describe("extendTrialVerdict (founder control — extension ONLY)", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const current = new Date("2026-09-19T23:59:59.999Z");

  it("accepts a later date and ends it at the close of that day", () => {
    const v = extendTrialVerdict({ current, requested: "2026-10-31", now });
    expect(v.ok && iso(v.endsAt)).toBe("2026-10-31T23:59:59.999Z");
  });

  it("sets a first trial on a plan that never had one", () => {
    const v = extendTrialVerdict({ current: null, requested: "2026-09-30", now });
    expect(v.ok && iso(v.endsAt)).toBe("2026-09-30T23:59:59.999Z");
  });

  it("REFUSES to shorten a running trial", () => {
    // A restaurant told "free until October" and charged in September is a refund
    // conversation. There is no undo for a settled charge, so there is no shorten.
    expect(extendTrialVerdict({ current, requested: "2026-09-01", now })).toEqual({
      ok: false,
      reason: "trialNotLonger",
    });
    // Same date is not an extension either.
    expect(extendTrialVerdict({ current, requested: "2026-09-19", now }).ok).toBe(false);
  });

  it("refuses a date in the past even when the trial already expired", () => {
    // Otherwise an "extension" onto an expired trial would look granted and change
    // nothing at all.
    const expired = new Date("2026-08-01T23:59:59.999Z");
    expect(extendTrialVerdict({ current: expired, requested: "2026-08-10", now })).toEqual({
      ok: false,
      reason: "trialNotLonger",
    });
    // TODAY is still an extension: a trial covers the whole of the day it names, so
    // 2026-08-19 buys the rest of the afternoon. Small, but honestly later than now.
    expect(extendTrialVerdict({ current: expired, requested: "2026-08-19", now }).ok).toBe(true);
    expect(extendTrialVerdict({ current: expired, requested: "2026-08-18", now }).ok).toBe(false);
  });

  it("refuses more than a year ahead", () => {
    const far = `${now.getUTCFullYear() + 1}-08-20`;
    expect(extendTrialVerdict({ current, requested: far, now })).toEqual({
      ok: false,
      reason: "trialTooFar",
    });
    // The boundary itself is allowed.
    expect(
      extendTrialVerdict({ current, requested: "2027-08-19", now }).ok,
    ).toBe(true);
    expect(MAX_TRIAL_MONTHS_AHEAD).toBe(12);
  });

  it("refuses junk, and a date that only LOOKS like one", () => {
    for (const requested of ["", "soon", "2026-13-01", "2026-02-31", "19/09/2026", "2026-9-1"]) {
      expect(extendTrialVerdict({ current, requested, now }).ok).toBe(false);
    }
    // 2026-02-31 is the one that matters: `new Date` rolls it to 3 March, which
    // would silently grant days nobody typed.
    expect(extendTrialVerdict({ current, requested: "2026-02-31", now })).toEqual({
      ok: false,
      reason: "trialDateInvalid",
    });
  });

  it("tolerates surrounding whitespace from a form field", () => {
    expect(extendTrialVerdict({ current, requested: " 2026-10-31 ", now }).ok).toBe(true);
  });
});
