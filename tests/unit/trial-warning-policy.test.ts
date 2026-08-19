import { describe, expect, it } from "vitest";
import {
  FOUNDER_HEADS_UP_DAYS,
  LATE_GRACE_DAYS,
  PARTNER_WARNING_DAYS,
  trialWarningVerdict,
  type TrialWarningFacts,
} from "@/lib/trial-warning-policy";

// The free period ends at the last instant of the UTC day it names (lib/trial.ts).
const ENDS = new Date("2026-09-19T23:59:59.999Z");
const at = (iso: string) => new Date(iso);

const base = (over: Partial<TrialWarningFacts> = {}): TrialWarningFacts => ({
  state: "trial",
  trialEndsAt: ENDS,
  now: at("2026-09-13T08:07:00Z"),
  sent: [],
  ...over,
});

describe("trialWarningVerdict — nothing to warn about", () => {
  it("says nothing about a plan with no free period", () => {
    // NULL is every row written before T-a: payable now, never in trial.
    expect(trialWarningVerdict(base({ trialEndsAt: null }))).toEqual({
      warn: false,
      reason: "noTrial",
    });
    expect(trialWarningVerdict(base({ trialEndsAt: new Date("nope") })).warn).toBe(false);
  });

  // The states where a warning would be a lie or an intrusion. `processing` is the
  // one that matters most: a first payment has SETTLED, so the free period is moot
  // and "start your subscription" would be asking twice for money already sent.
  it.each(["active", "processing", "inactive", "none"] as const)(
    "says nothing about a %s plan",
    (state) => {
      expect(trialWarningVerdict(base({ state }))).toEqual({
        warn: false,
        reason: "notWarnable",
      });
    },
  );

  it("says nothing yet a fortnight and a bit out", () => {
    expect(trialWarningVerdict(base({ now: at("2026-09-05T08:07:00Z") }))).toEqual({
      warn: false,
      reason: "tooEarly",
    });
  });

  it("says nothing about a trial that lapsed long ago", () => {
    // The pay button has been back for days, /admin/billing flags it, and "your free
    // period ended five weeks ago" is noise arriving as news. This is also what stops
    // the first run after deployment from mailing about history.
    expect(trialWarningVerdict(base({ state: "pay", now: at("2026-09-30T08:07:00Z") }))).toEqual({
      warn: false,
      reason: "tooLate",
    });
  });
});

describe("trialWarningVerdict — the founder hears first", () => {
  it("warns the founder alone, a fortnight out", () => {
    const out = trialWarningVerdict(base({ now: at("2026-09-06T08:07:00Z") }));
    expect(out).toMatchObject({ warn: true, due: ["founder"], phase: "soon" });
  });

  it("puts the founder ahead of the partner when both come due at once", () => {
    // A trial set with under a fortnight to run: the founder's heads-up and the
    // partner's warning fall in the same sweep. `due` is ordered, and the sweep sends
    // in that order — so the partner is never the first to know.
    const out = trialWarningVerdict(base({ trialEndsAt: at("2026-09-16T23:59:59.999Z") }));
    expect(out).toMatchObject({ warn: true, due: ["founder", "soon"] });
  });

  it("keeps quiet once the founder has already been told about this date", () => {
    expect(trialWarningVerdict(base({ now: at("2026-09-06T08:07:00Z"), sent: ["founder"] }))).toEqual(
      { warn: false, reason: "alreadyWarned" },
    );
  });
});

describe("trialWarningVerdict — what the partner is told, and when", () => {
  it("warns a week out, and counts the days as the dashboard does", () => {
    const out = trialWarningVerdict(base({ sent: ["founder"] }));
    expect(out).toMatchObject({ warn: true, due: ["soon"], phase: "soon", daysLeft: 7 });
  });

  it("warns on the last day, and says today", () => {
    const out = trialWarningVerdict(
      base({ now: at("2026-09-19T08:07:00Z"), sent: ["founder", "soon"] }),
    );
    expect(out).toMatchObject({ warn: true, due: ["final"], phase: "today", daysLeft: 1 });
  });

  it("sends ONE mail when a skipped sweep makes both partner milestones due", () => {
    // The more urgent one wins. `soon` can never come due afterwards — it requires a
    // trial that is still running — so nothing is silently marked as sent.
    const out = trialWarningVerdict(base({ now: at("2026-09-19T08:07:00Z") }));
    expect(out).toMatchObject({ warn: true, due: ["founder", "final"] });
  });
});

describe("trialWarningVerdict — a late cron tells the truth instead of the milestone", () => {
  it("still sends the day-of warning two days late, saying it has ENDED", () => {
    // GitHub's schedule is best-effort. Thresholds (not equality) mean the warning
    // survives a skipped day; deriving the phase from the CLOCK rather than from the
    // milestone means it does not then claim "it ends today" about a past date.
    const out = trialWarningVerdict(base({ state: "pay", now: at("2026-09-21T08:07:00Z") }));
    expect(out).toMatchObject({ warn: true, due: ["founder", "final"], phase: "ended", daysLeft: 0 });
  });

  it("gives up once the grace window has passed", () => {
    const out = trialWarningVerdict(base({ state: "pay", now: at("2026-09-23T08:07:00Z") }));
    expect(out).toEqual({ warn: false, reason: "tooLate" });
  });
});

describe("trialWarningVerdict — an extension re-arms the warnings", () => {
  it("warns again about a NEW end date, because the sentence is about a date", () => {
    // The sweep keys its markers on the end date, so a plan extended from 19 Sept to
    // 19 Oct arrives here with an empty `sent` for the new date. A partner told "free
    // until 19 September" must hear the new date rather than nothing.
    const extended = at("2026-10-19T23:59:59.999Z");
    const out = trialWarningVerdict(
      base({ trialEndsAt: extended, now: at("2026-10-13T08:07:00Z"), sent: [] }),
    );
    expect(out).toMatchObject({ warn: true, due: ["founder", "soon"], endsAt: extended });
  });

  it("says nothing at all once every milestone for this date is spent", () => {
    expect(
      trialWarningVerdict(
        base({ now: at("2026-09-19T08:07:00Z"), sent: ["founder", "soon", "final"] }),
      ),
    ).toEqual({ warn: false, reason: "alreadyWarned" });
  });
});

describe("the cadence itself", () => {
  it("is founder 14 / partner 7 / three days of grace", () => {
    // Pinned by test because the whole design depends on the founder threshold being
    // the widest: it must subsume both partner milestones, or a partner could be
    // warned about a trial the owner never had a chance to extend.
    expect(FOUNDER_HEADS_UP_DAYS).toBeGreaterThan(PARTNER_WARNING_DAYS);
    expect(PARTNER_WARNING_DAYS).toBeGreaterThan(0);
    expect(LATE_GRACE_DAYS).toBe(3);
  });
});
