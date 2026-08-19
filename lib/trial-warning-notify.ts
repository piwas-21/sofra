// The scheduled half of the trial-ending warning (SOFRA-PARTNER-FLEXIBILITY-PLAN
// T-d, EMAIL-SPEC-CONTROL-PLANE G2/G3). Three modules, one job:
//   trial-warning-policy.ts     — decides WHETHER, and what is true when it does
//   trial-warning-candidates.ts — finds who is due, and what was already said
//   this file                   — says it, and records that it was said
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
import { payerAddress } from "@/lib/payer-contact";
import type { TrialWarning } from "@/lib/trial-warning-policy";
import {
  TRIAL_WARNING_ACTIONS,
  bump,
  endsOnKey,
  findTrialWarningCandidates,
  type TrialWarningTodo,
} from "@/lib/trial-warning-candidates";
import { sendFounderNotice, sendPayerWarning } from "@/lib/trial-warning-send";

export { TRIAL_WARNING_ACTIONS };

export interface TrialWarningSweepResult {
  /** Plans in the window with at least one milestone still outstanding. */
  considered: number;
  founderNotices: number;
  payerWarnings: number;
  /** Why the rest were passed over — counts only, never an address. */
  skipped: Record<string, number>;
}

/** What one attempted milestone did: two of these are successes, the rest reasons. */
type Outcome = "founder" | "payer" | "noRecipient" | "noFounderInbox" | "sendFailed";

/**
 * The language the control plane HOLDS for each payer: the partner application their
 * address was captured on. One query for the batch; the self-serve fallback
 * (`signupRequest.locale`) rides along on the plan already.
 */
async function heldLocales(todo: TrialWarningTodo[]): Promise<Map<string, string>> {
  const applications = await db.partnerApplication.findMany({
    // Lowercased on both sides: the intake stores `data.email.toLowerCase()` while a
    // plan's address may be admin-typed in any case, and a mismatch here silently
    // downgrades a francophone partner to English.
    where: { email: { in: todo.map((t) => payerAddress(t.plan)?.toLowerCase() ?? "") } },
    orderBy: { createdAt: "desc" },
    select: { email: true, locale: true },
  });
  const held = new Map<string, string>();
  for (const a of applications) {
    if (!held.has(a.email.toLowerCase())) held.set(a.email.toLowerCase(), a.locale);
  }
  return held;
}

/** The send itself. `null` means there was nobody to write to — the one case that
 *  must NOT leave a marker behind, because it is not a thing we have said. */
async function attempt(
  item: TrialWarningTodo,
  warning: TrialWarning,
  inbox: string | undefined,
  locales: Map<string, string>,
  to: string | null,
): Promise<{ sent: boolean } | null> {
  const { plan, sub, verdict } = item;
  if (warning === "founder") return sendFounderNotice(inbox, plan, sub, verdict);
  if (!to) return null;
  return sendPayerWarning(to, plan, sub, verdict, locales.get(to.toLowerCase()));
}

/**
 * Send ONE milestone for ONE plan, and record it.
 *
 * The audit row is written AFTER the send, so it carries the outcome — and it is
 * written even when the send FAILED: re-warning on every later sweep is worse than
 * one missed mail the founder can see (`emailed: false`) and re-send by hand.
 */
async function deliver(
  item: TrialWarningTodo,
  warning: TrialWarning,
  inbox: string | undefined,
  locales: Map<string, string>,
): Promise<Outcome> {
  const { plan, verdict } = item;
  const result = await attempt(item, warning, inbox, locales, payerAddress(plan));
  if (!result) return "noRecipient";

  await audit(null, TRIAL_WARNING_ACTIONS[warning], "TenantBilling", plan.id, {
    tenantSlug: plan.tenantSlug,
    endsOn: endsOnKey(verdict.endsAt),
    phase: verdict.phase,
    daysLeft: verdict.daysLeft,
    emailed: result.sent,
  });

  if (result.sent) return warning === "founder" ? "founder" : "payer";
  return warning === "founder" && !inbox ? "noFounderInbox" : "sendFailed";
}

export async function runTrialWarningSweep(
  now: Date = new Date(),
): Promise<TrialWarningSweepResult> {
  const { todo, skipped } = await findTrialWarningCandidates(now);
  if (todo.length === 0) {
    return { considered: 0, founderNotices: 0, payerWarnings: 0, skipped };
  }

  const locales = await heldLocales(todo);
  const inbox = founderInbox();
  let founderNotices = 0;
  let payerWarnings = 0;

  for (const item of todo) {
    // Per plan, so one unusable row cannot abort the batch (slug only in the log
    // line — never an address, CLAUDE.md §5.8).
    try {
      for (const warning of item.verdict.due) {
        // `due` is ordered founder-first, and this loop is why: the owner made the
        // partner's warning conditional on his own chance to extend, so even on the
        // one run where both come due he is still told first.
        const outcome = await deliver(item, warning, inbox, locales);
        if (outcome === "founder") founderNotices += 1;
        else if (outcome === "payer") payerWarnings += 1;
        else bump(skipped, outcome);
      }
    } catch (e) {
      bump(skipped, "error");
      console.error("trial-warning sweep: plan failed —", item.plan.tenantSlug, e);
    }
  }

  return { considered: todo.length, founderNotices, payerWarnings, skipped };
}
