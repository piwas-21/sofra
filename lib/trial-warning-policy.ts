// Should this plan's free period be warned about — and to whom, saying what?
//
// The pure half of the trial-ending warning (SOFRA-PARTNER-FLEXIBILITY-PLAN T-d,
// EMAIL-SPEC-CONTROL-PLANE G2). Split from the sweep exactly as `go-live-policy.ts`
// is split from `go-live-notify.ts`: this half is total, decidable and unit-testable;
// the half that touches Resend and the database is not.
//
// The policy it serves is the owner's, answered as open decision O-T2: a trial is one
// month with no card, no mandate and nothing taken up front, and when it ends
// NOTHING happens automatically — no charge, no suspension, the pay button simply
// returns. The only thing missing was that the payer was never TOLD, and that the
// founder never got a chance to extend before they were. So this module decides two
// separate things, and keeps them separate:
//
//   WHEN to speak — a set of milestones, each crossed once per trial end date;
//   WHAT is true when we do — the phase, derived from the clock at send time.
//
// Keeping those apart is what makes a late cron honest instead of wrong. GitHub's
// `schedule:` is best-effort and skips; if the day-of warning goes out two days late,
// the milestone still fires (thresholds, never equality) and the mail says "your free
// period ended on the 19th" rather than the lie "it ends today".

import type { PlanState } from "@/lib/billing-display";
import { trialView } from "@/lib/trial";

/** The founder's heads-up, in days before the end. */
export const FOUNDER_HEADS_UP_DAYS = 14;
/** The payer's advance warning, in days before the end. */
export const PARTNER_WARNING_DAYS = 7;
/**
 * How long after the end a missed warning is still worth sending.
 *
 * Bounds two different things with one rule. A cron that was down over a weekend
 * should still deliver the day-of warning (late, and saying so). A plan whose trial
 * lapsed weeks ago should NEVER be mailed about it now: the pay button has been back
 * all that time, the founder's `/admin/billing` flags it, and "your free period ended
 * five weeks ago" is noise arriving as if it were news. It is also the guard that
 * stops the first run after deployment from mailing about history.
 */
export const LATE_GRACE_DAYS = 3;

/** Who is being told, and at which milestone. Ordered: the founder always first. */
export type TrialWarning = "founder" | "soon" | "final";

/** What is TRUE about the free period at the moment of sending. */
export type TrialPhase = "soon" | "today" | "ended";

export type TrialWarningFacts = {
  /** From the shared `planState()` — the same verdict the payer's own page renders. */
  state: PlanState;
  /** `TenantBilling.trialEndsAt`. */
  trialEndsAt: Date | null;
  now: Date;
  /**
   * Milestones already sent **for this exact end date** (audit-log markers).
   *
   * Keyed on the date and not merely on the plan, which is deliberate: an extension
   * moves the date, and the sentence we send is *about* a date. A partner told "free
   * until 19 September" whose founder then pushes them to 19 October must hear the
   * new date — so a new end date re-arms the warnings, and a given end date can never
   * be warned about twice.
   */
  sent: readonly TrialWarning[];
};

export type TrialWarningVerdict =
  | { warn: true; due: TrialWarning[]; phase: TrialPhase; endsAt: Date; daysLeft: number }
  | {
      warn: false;
      reason: "noTrial" | "notWarnable" | "tooEarly" | "tooLate" | "alreadyWarned";
    };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC starting the day this instant falls in. */
function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/**
 * What is TRUE right now about a free period ending at `end`.
 *
 * A named function rather than a chained ternary (Sonar S3358): this is the rule that
 * keeps a late warning honest, and it deserves to be read as three cases rather than
 * skimmed as one line.
 */
function phaseAt(now: number, lastDayStarts: number, end: number): TrialPhase {
  if (now < lastDayStarts) return "soon";
  return now <= end ? "today" : "ended";
}

export function trialWarningVerdict(facts: TrialWarningFacts): TrialWarningVerdict {
  const endsAt = facts.trialEndsAt;
  if (!endsAt || Number.isNaN(endsAt.getTime())) return { warn: false, reason: "noTrial" };

  // The ONLY two states worth a word about a free period, and both come from the
  // shared `planState()` rather than from a second reading of the columns here:
  //   trial — the ask is suppressed *because* of the free period. This is the case.
  //   pay   — the free period has just lapsed and the ask is back, which is what the
  //           day-of warning is about when it goes out late.
  // Every other state is a plan that must never be mailed: `active` is charging,
  // `processing` has a settled first payment (money has moved — the trial is moot),
  // `inactive` is CANCELED/SUSPENDED, `none` has no subscription at all.
  if (facts.state !== "trial" && facts.state !== "pay") {
    return { warn: false, reason: "notWarnable" };
  }

  const now = facts.now.getTime();
  const end = endsAt.getTime();
  if (now > end + LATE_GRACE_DAYS * DAY_MS) return { warn: false, reason: "tooLate" };

  // THRESHOLDS, never equality. `daysLeft === 7` would mean a sweep that GitHub
  // skipped for a day silently drops that warning forever; `<= 7` means the next run
  // sends it, late, which is the whole reason the marker and the phase are separate.
  const lastDayStarts = startOfUtcDay(endsAt).getTime();
  const finalDue = now >= lastDayStarts;
  // Suppressed once the last day has begun: a partner meeting both milestones in one
  // run (a sweep that missed a week) gets ONE mail, the more urgent one. `soon`
  // cannot come due again afterwards — it requires a trial that is still running.
  const soonDue = !finalDue && now >= end - PARTNER_WARNING_DAYS * DAY_MS;
  // Subsumes both partner milestones (14 >= 7 >= 0), which is what guarantees the
  // owner's condition — *"if me as owner has not extended their free usage"* — can
  // be met even for a trial set with less than a fortnight to run: the founder's
  // notice is due in the same sweep, and the sweep sends `due` in order.
  const founderDue = now >= end - FOUNDER_HEADS_UP_DAYS * DAY_MS;

  const crossed: TrialWarning[] = [
    ...(founderDue ? (["founder"] as const) : []),
    ...(finalDue ? (["final"] as const) : []),
    ...(soonDue ? (["soon"] as const) : []),
  ];
  if (crossed.length === 0) return { warn: false, reason: "tooEarly" };

  const due = crossed.filter((w) => !facts.sent.includes(w));
  if (due.length === 0) return { warn: false, reason: "alreadyWarned" };

  const view = trialView(endsAt, facts.now);
  return {
    warn: true,
    due,
    // Derived from the clock, not from the milestone: what we say has to be true when
    // it is said, whatever made us say it.
    phase: phaseAt(now, lastDayStarts, end),
    endsAt,
    daysLeft: view.kind === "active" ? view.daysLeft : 0,
  };
}
