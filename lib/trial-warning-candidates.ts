// WHO is due a trial-ending warning on this run — the query half of T-d.
//
// Split out of `trial-warning-notify.ts` when that function reached a cognitive
// complexity of 30 (Sonar S3776). The split is along the seam the feature already
// had: this module answers *who is due and what has already been said to them*, and
// the sweep answers *say it and record that it was said*. The send-once argument is
// the thing a reviewer most needs to be able to check, and it is now readable in one
// screen instead of being interleaved with sending.
//
// The marker read is the load-bearing part. It is one query for the whole population
// (never one per plan per run), and its key is `{plan, milestone, trial END DATE}` —
// the end date being what makes an extension re-arm the warnings rather than silence
// them forever.

import { db } from "@/lib/db";
import { planState } from "@/lib/billing-display";
import {
  FOUNDER_HEADS_UP_DAYS,
  LATE_GRACE_DAYS,
  trialWarningVerdict,
  type TrialWarning,
} from "@/lib/trial-warning-policy";
import type { DueWarning, WarnablePlan, WarnableSubscription } from "@/lib/trial-warning-send";

/** One audit action per milestone — distinct strings rather than one action with a
 *  field, so "sent already?" is an indexed query and not a JSON path filter. */
export const TRIAL_WARNING_ACTIONS: Record<TrialWarning, string> = {
  founder: "billing.trial.ending.founder",
  soon: "billing.trial.ending.soon",
  final: "billing.trial.ending.final",
};
const WARNING_OF = new Map(
  Object.entries(TRIAL_WARNING_ACTIONS).map(([w, a]) => [a, w as TrialWarning]),
);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day a trial ends — what a marker is keyed on, and what a mail names. */
export const endsOnKey = (d: Date) => d.toISOString().slice(0, 10);

/** A plan that is due at least one warning, with everything the send needs. */
export type TrialWarningTodo = {
  plan: WarnablePlan & { name: string; tenantSlug: string };
  sub: WarnableSubscription;
  verdict: DueWarning;
};

export type TrialWarningCandidates = {
  todo: TrialWarningTodo[];
  /** Why the rest were passed over — counts only, never an address. */
  skipped: Record<string, number>;
};

/** Count a reason. A module-level helper rather than a closure, so it does not add
 *  to the cognitive complexity of the function that uses it. */
export function bump(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

/**
 * Plans whose free period falls inside the widest milestone, both ends bounded.
 *
 * The window lives in the DATABASE rather than in the loop: a trial that ended last
 * month is never loaded, and NULL `trialEndsAt` (every row written before T-a) is
 * excluded by the range itself.
 */
function plansInWindow(now: Date) {
  return db.tenantBilling.findMany({
    where: {
      trialEndsAt: {
        gte: new Date(now.getTime() - LATE_GRACE_DAYS * DAY_MS),
        lte: new Date(now.getTime() + FOUNDER_HEADS_UP_DAYS * DAY_MS),
      },
    },
    select: {
      id: true,
      tenantSlug: true,
      name: true,
      email: true,
      trialEndsAt: true,
      // Newest subscription + first payments only: exactly what `planState` reads on
      // the payer's own page (app/(control)/dashboard/billing/page.tsx).
      subscriptions: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { status: true, amountCents: true, interval: true },
      },
      payments: { where: { sequenceType: "first" }, select: { sequenceType: true, status: true } },
      billingIdentity: { select: { billingEmail: true } },
      // `locale` since G9: the account itself now holds the language, so the
      // sweep no longer has to look the payer's address up in the intake table it
      // was captured on.
      client: { select: { partner: { select: { name: true, email: true, locale: true } } } },
      payer: { select: { name: true, email: true, locale: true } },
      signupRequest: { select: { locale: true } },
    },
  });
}

/** `plan id + trial end date` → the milestones already sent for THAT date. */
async function markersFor(planIds: string[]): Promise<Map<string, TrialWarning[]>> {
  const rows = await db.auditLog.findMany({
    where: {
      action: { in: Object.values(TRIAL_WARNING_ACTIONS) },
      entityType: "TenantBilling",
      entityId: { in: planIds },
    },
    select: { entityId: true, action: true, meta: true },
  });
  const index = new Map<string, TrialWarning[]>();
  for (const row of rows) {
    const warning = WARNING_OF.get(row.action);
    const endsOn = (row.meta as { endsOn?: string } | null)?.endsOn;
    if (!warning || !row.entityId || !endsOn) continue;
    const key = `${row.entityId}:${endsOn}`;
    index.set(key, [...(index.get(key) ?? []), warning]);
  }
  return index;
}

export async function findTrialWarningCandidates(now: Date): Promise<TrialWarningCandidates> {
  const skipped: Record<string, number> = {};
  const plans = await plansInWindow(now);
  if (plans.length === 0) return { todo: [], skipped };

  const markers = await markersFor(plans.map((p) => p.id));
  const todo: TrialWarningTodo[] = [];
  for (const plan of plans) {
    const sub = plan.subscriptions[0];
    const endsAt = plan.trialEndsAt;
    // Unreachable — the window query cannot select a NULL — but a guard rather than
    // a cast, so nothing here depends on a claim the type system was told to ignore.
    if (!endsAt) {
      bump(skipped, "noTrial");
      continue;
    }
    const verdict = trialWarningVerdict({
      // The SAME verdict the payer's dashboard renders. A second opinion about
      // whether a plan is in trial is how the mail and the page come to disagree.
      state: planState(sub, plan.payments, { trialEndsAt: endsAt, now }),
      trialEndsAt: endsAt,
      now,
      sent: markers.get(`${plan.id}:${endsOnKey(endsAt)}`) ?? [],
    });
    if (!verdict.warn) {
      bump(skipped, verdict.reason);
      continue;
    }
    // Unreachable (no subscription is `planState` "none"), and what lets the price
    // reach the mail without a non-null assertion.
    if (!sub) {
      bump(skipped, "noSubscription");
      continue;
    }
    todo.push({ plan, sub, verdict });
  }
  return { todo, skipped };
}
