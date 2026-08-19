// The free period on a plan — one nullable date, and the arithmetic around it.
//
// Policy (SOFRA-PARTNER-FLEXIBILITY-PLAN T): an approved partner gets ONE MONTH
// free on every tenant they onboard, because a reseller is selling with a live
// site rather than buying one, and asking them to pay before the restaurant has
// said yes is asking them to fund our demo. Direct self-serve OWNER plans get NO
// trial — they pay before their tenant is provisioned (O2), and that gate is the
// abuse defence, not an inconvenience to soften.
//
// Deliberately ONE nullable column and no status enum: "in trial" is
// `trialEndsAt > now`, and a second column that can disagree with the date is a
// bug surface, not a convenience. NULL means "no trial — payable now", which is
// what every row that existed before this module means.
//
// Pure — no DB, no clock. `now` is always passed in, so every rule below is
// testable and reads the same on the partner's page, the founder's list and the
// server action that writes the column.

/** The default free period for a reseller plan, in whole months. */
export const TRIAL_MONTHS = 1;

/** How far into the future the founder may push a trial in one step. A trial is
 *  a courtesy, not a licence: a fat-fingered year in the date field would
 *  otherwise hand out a decade of free product with no second look. */
export const MAX_TRIAL_MONTHS_AHEAD = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Add whole months in UTC, **clamping** to the last day of the target month.
 *
 * The month-end rule, chosen and pinned by test: **31 January + 1 month = 28
 * February** (29th in a leap year), not 3 March. `Date.setUTCMonth` overflows
 * instead of clamping, which is how `subscriptionStartDate` (lib/billing.ts)
 * behaves and documents — acceptable for a machine-read charge anchor that
 * settles after one wrap, and wrong for a date a human is *told*. "Free until 3
 * March" for a plan defined on 31 January is three extra free days nobody
 * decided to give, and every clamp here can only ever shorten the free period by
 * at most three days relative to the overflow — never lengthen it, and never
 * land in a month the reader did not expect.
 */
export function addMonthsClampedUtc(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const day = from.getUTCDate();
  // Day 0 of the NEXT month is the last day of the target month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = new Date(from);
  d.setUTCFullYear(year, month, Math.min(day, lastDay));
  return d;
}

/**
 * The last instant of the UTC day a date falls in.
 *
 * A trial ends at the END of the day it names, so "free until 19 September" is
 * true for the whole of 19 September in every timezone we bill from. Without it
 * a plan defined at 09:14 would start asking for money at 09:14 a month later —
 * on a date the partner had been shown as free.
 */
export function endOfUtcDay(d: Date): Date {
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/** The default trial end for a plan defined at `now` (T2). */
export function defaultTrialEnd(now: Date): Date {
  return endOfUtcDay(addMonthsClampedUtc(now, TRIAL_MONTHS));
}

/**
 * The trial a NEWLY DEFINED plan starts life with — the whole of the policy, in
 * one place, so no call site can hand one out by accident.
 *
 * **Reseller-paid plans only.** A partner sells with a live site: until the
 * restaurant says yes they are funding our demo, so the first month is on us —
 * with a stated end date instead of "until somebody remembers", which is what it
 * was before this column existed.
 *
 * **A direct self-serve OWNER plan gets none**, and that is not an oversight.
 * Those pay before their tenant is provisioned (O2 `slugProvisionVerdict`), and
 * that gate is the abuse defence for anonymous signups — a trial there would
 * invert it and let anyone mint a free tenant. The reseller side needs no such
 * gate: a partner is an approved, known party (ADR-009) and the plan is created
 * by the founder, not by a stranger with an email address.
 */
export function trialEndForNewPlan(args: { resellerPaid: boolean; now: Date }): Date | null {
  return args.resellerPaid ? defaultTrialEnd(args.now) : null;
}

/** What a reader should be told about the free period on a plan. */
export type TrialView =
  /** No trial was ever set — the plan is payable now. */
  | { kind: "none" }
  /** Free right now; `daysLeft` counts today as one. */
  | { kind: "active"; endsAt: Date; daysLeft: number }
  /** The free period is over; the plan is payable again. */
  | { kind: "expired"; endsAt: Date };

/** `trialEndsAt` + `now` → the whole state. There is no other source. */
export function trialView(trialEndsAt: Date | null | undefined, now: Date): TrialView {
  if (!trialEndsAt || Number.isNaN(trialEndsAt.getTime())) return { kind: "none" };
  if (trialEndsAt.getTime() <= now.getTime()) return { kind: "expired", endsAt: trialEndsAt };
  return {
    kind: "active",
    endsAt: trialEndsAt,
    // Ceiling, so the final partial day reads "1 day left" rather than "0".
    daysLeft: Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS),
  };
}

/** Is this plan inside its free period right now? */
export function isTrialActive(trialEndsAt: Date | null | undefined, now: Date): boolean {
  return trialView(trialEndsAt, now).kind === "active";
}

/** Why an extension was refused. Each is a `control.errors.*` message key. */
export type TrialRefusal = "trialDateInvalid" | "trialNotLonger" | "trialTooFar";

export type TrialExtension =
  | { ok: true; endsAt: Date }
  | { ok: false; reason: TrialRefusal };

/**
 * Judge a founder's requested trial end (`YYYY-MM-DD`, from a date input).
 *
 * **Extension only.** A trial may be set, or pushed further out, and never
 * pulled in: a restaurant told "free until October" and charged in September is
 * a refund conversation and a lost partner, and there is no undo for a charge
 * that has already settled. Shortening one is a conversation, not a form — the
 * founder can always take the plan through the normal payment path early.
 *
 * The parse is strict on purpose. `new Date("2026-02-31")` silently becomes 3
 * March, and a date input on a locale we do not control is exactly where that
 * arrives; a round-trip check refuses it instead of granting three days nobody
 * typed.
 */
export function extendTrialVerdict(args: {
  current: Date | null | undefined;
  requested: string;
  now: Date;
}): TrialExtension {
  const requested = args.requested.trim();
  if (!ISO_DATE.test(requested)) return { ok: false, reason: "trialDateInvalid" };
  const parsed = new Date(`${requested}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: "trialDateInvalid" };
  // Round-trip: rejects 2026-02-31 and friends, which Date would roll forward.
  if (parsed.toISOString().slice(0, 10) !== requested) {
    return { ok: false, reason: "trialDateInvalid" };
  }

  const endsAt = endOfUtcDay(parsed);
  // Later than BOTH the current end and now: the second half is what stops a
  // plan whose trial already expired from being "extended" into the past, which
  // would look like a granted extension and change nothing.
  const floor = Math.max(args.current?.getTime() ?? 0, args.now.getTime());
  if (endsAt.getTime() <= floor) return { ok: false, reason: "trialNotLonger" };
  if (endsAt.getTime() > endOfUtcDay(addMonthsClampedUtc(args.now, MAX_TRIAL_MONTHS_AHEAD)).getTime()) {
    return { ok: false, reason: "trialTooFar" };
  }
  return { ok: true, endsAt };
}
