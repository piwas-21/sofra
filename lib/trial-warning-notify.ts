// The scheduled half of the trial-ending warning (SOFRA-PARTNER-FLEXIBILITY-PLAN
// T-d, EMAIL-SPEC-CONTROL-PLANE G2/G3). Pair of `trial-warning-policy.ts`: that one
// decides, this one finds, sends and records.
//
// IDEMPOTENCY IS THE WHOLE JOB. GitHub's `schedule:` is best-effort: it fires late,
// it fires twice, and it skips. A partner receiving "your free period ends in 7
// days" four times is worse than never receiving it — so "have we said this yet" is
// answered from a DURABLE record, never from the schedule.
//
// That record is the AUDIT LOG, following `go-live-notify.ts` rather than adding a
// `lastWarnedAt` column. Three reasons, in order of weight: (1) a column holds only
// the LAST warning, and there are three per trial (founder, 7-day, day-of) — it
// would have to be three columns, or a bitfield, which is an audit log with the
// history filed off; (2) the same row answers "was the partner told, and did the
// mail actually leave?" — `{emailed}` rides on it, and a timestamp cannot carry
// that; (3) the marker is keyed on the trial's END DATE, so an EXTENSION re-arms the
// warnings by itself. Audit rows are retained 18 months
// (RETENTION_AUDIT_LOG_MONTHS), two orders of magnitude longer than any warning
// window, so a marker cannot age out from under a trial that is still running.

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { founderInbox } from "@/lib/email";
import { planState } from "@/lib/billing-display";
import {
  FOUNDER_HEADS_UP_DAYS,
  LATE_GRACE_DAYS,
  trialWarningVerdict,
  type TrialWarning,
} from "@/lib/trial-warning-policy";
import { payerAddress } from "@/lib/payer-contact";
import { sendFounderNotice, sendPayerWarning } from "@/lib/trial-warning-send";

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
const endsOnKey = (d: Date) => d.toISOString().slice(0, 10);

export interface TrialWarningSweepResult {
  /** Plans in the window with at least one milestone still outstanding. */
  considered: number;
  founderNotices: number;
  payerWarnings: number;
  /** Why the rest were passed over — counts only, never an address. */
  skipped: Record<string, number>;
}

export async function runTrialWarningSweep(
  now: Date = new Date(),
): Promise<TrialWarningSweepResult> {
  const skipped: Record<string, number> = {};
  const skip = (r: string) => void (skipped[r] = (skipped[r] ?? 0) + 1);
  const empty = { considered: 0, founderNotices: 0, payerWarnings: 0, skipped };

  // The window, both ends, in the DATABASE rather than the loop: a trial that ended
  // last month is never loaded, and NULL `trialEndsAt` (every pre-T-a row) is
  // excluded by the range itself.
  const candidates = await db.tenantBilling.findMany({
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
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, amountCents: true, interval: true },
      },
      payments: { where: { sequenceType: "first" }, select: { sequenceType: true, status: true } },
      billingIdentity: { select: { billingEmail: true } },
      client: { select: { partner: { select: { name: true, email: true } } } },
      payer: { select: { name: true, email: true } },
      signupRequest: { select: { locale: true } },
    },
  });
  if (candidates.length === 0) return empty;

  // One query for the whole population's markers, not one per plan per run.
  const markers = await db.auditLog.findMany({
    where: {
      action: { in: Object.values(TRIAL_WARNING_ACTIONS) },
      entityType: "TenantBilling",
      entityId: { in: candidates.map((c) => c.id) },
    },
    select: { entityId: true, action: true, meta: true },
  });
  const sentBefore = new Map<string, TrialWarning[]>();
  for (const m of markers) {
    const warning = WARNING_OF.get(m.action);
    // `endsOn` is what makes an extension re-arm the warnings: a marker silences a
    // milestone only for the date it was written about.
    const endsOn = (m.meta as { endsOn?: string } | null)?.endsOn;
    if (!warning || !m.entityId || !endsOn) continue;
    const key = `${m.entityId}:${endsOn}`;
    sentBefore.set(key, [...(sentBefore.get(key) ?? []), warning]);
  }

  const todo = candidates.flatMap((plan) => {
    const sub = plan.subscriptions[0];
    const verdict = trialWarningVerdict({
      // The SAME verdict the payer's dashboard renders. A second opinion about
      // whether a plan is in trial is how the mail and the page come to disagree.
      state: planState(sub, plan.payments, { trialEndsAt: plan.trialEndsAt, now }),
      trialEndsAt: plan.trialEndsAt,
      now,
      sent: sentBefore.get(`${plan.id}:${endsOnKey(plan.trialEndsAt as Date)}`) ?? [],
    });
    if (!verdict.warn) {
      skip(verdict.reason);
      return [];
    }
    // Unreachable (no subscription is `planState` "none"), and what lets the price
    // reach the mail without a non-null assertion.
    if (!sub) {
      skip("noSubscription");
      return [];
    }
    return [{ plan, sub, verdict }];
  });
  if (todo.length === 0) return empty;

  // The language the control plane HOLDS for each payer: the partner application
  // their address was captured on. One query for the batch; the self-serve fallback
  // (`signupRequest.locale`) rides along on the plan already.
  const applications = await db.partnerApplication.findMany({
    // Lowercased on both sides: the intake stores `data.email.toLowerCase()` while a
    // plan's address may be admin-typed in any case, and a mismatch here silently
    // downgrades a francophone partner to English.
    where: { email: { in: todo.map((t) => payerAddress(t.plan)?.toLowerCase() ?? "") } },
    orderBy: { createdAt: "desc" },
    select: { email: true, locale: true },
  });
  const heldLocale = new Map<string, string>();
  for (const a of applications) {
    if (!heldLocale.has(a.email.toLowerCase())) heldLocale.set(a.email.toLowerCase(), a.locale);
  }

  const inbox = founderInbox();
  let founderNotices = 0;
  let payerWarnings = 0;

  for (const { plan, sub, verdict } of todo) {
    const to = payerAddress(plan);
    // Per plan, so one unusable row cannot abort the batch (slug only in the log
    // line — never an address, CLAUDE.md §5.8).
    try {
      for (const warning of verdict.due) {
        // `due` is ordered founder-first, and this loop is why: the owner made the
        // partner's warning conditional on his own chance to extend, so even on the
        // one run where both come due he is still told first.
        if (warning !== "founder" && !to) {
          skip("noRecipient");
          continue;
        }
        const { sent } =
          warning === "founder"
            ? await sendFounderNotice(inbox, plan, sub, verdict)
            : await sendPayerWarning(to as string, plan, sub, verdict, heldLocale.get(to!.toLowerCase()));
        // AFTER the send, so the row carries its outcome — and written even when the
        // send failed: re-warning on every later sweep is worse than one missed mail
        // the founder can see (`emailed: false`) and re-send by hand.
        await audit(null, TRIAL_WARNING_ACTIONS[warning], "TenantBilling", plan.id, {
          tenantSlug: plan.tenantSlug,
          endsOn: endsOnKey(verdict.endsAt),
          phase: verdict.phase,
          daysLeft: verdict.daysLeft,
          emailed: sent,
        });
        if (!sent) skip(warning === "founder" && !inbox ? "noFounderInbox" : "sendFailed");
        else if (warning === "founder") founderNotices += 1;
        else payerWarnings += 1;
      }
    } catch (e) {
      skip("error");
      console.error("trial-warning sweep: plan failed —", plan.tenantSlug, e);
    }
  }

  return { considered: todo.length, founderNotices, payerWarnings, skipped };
}
