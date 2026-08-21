// "Yes, we still have your menu — until the 4th of March."
//
// This is the sentence the whole feature exists for. The owner's scenario is a
// TRIAL restaurant that goes quiet, and comes back two months later asking
// whether they have to start from scratch. Answering it required opening a
// terminal on a box; now it is a line on /admin/backups.
//
// Pure: `now` and the window are always passed in, so every rule here is
// testable and reads identically wherever it is rendered.
//
// ── The honesty rule, and it is the one that matters ──────────────────────────
// The control plane does NOT enforce retention. `restic forget --prune` on the
// box does, on a schedule the deploy repo owns, and this container cannot reach
// a box to check (ADR-012 invariant 2 — the credential direction is BOX → SOFRA,
// never back). So the number here is a DISPLAY of the box's policy, not the
// policy itself, and the two are meant to be set to the same value in both
// places. If they ever disagree, the box wins and this page is the one that is
// wrong — which is why the window is an env var rather than a constant compiled
// into a promise we cannot keep.
//
// The consequence is a rule the code enforces on itself: NEVER promise longer
// than we can see. Every date below is derived from an artifact we actually
// hold, so the worst case is that we under-promise about a copy the box still
// has — never that a restaurant is told their data is safe for another month
// when it was pruned last night.

/**
 * How long a departed tenant's data is kept, in days. **Six months.**
 *
 * Chosen against two opposing pressures rather than picked round. Long enough to
 * cover a seasonal closure and a restaurant that says "let us think about it
 * over the winter" — the owner's actual case, where 30 or 90 days would answer
 * "no, it's gone" to exactly the customer we wanted to win back. Short enough to
 * still be a defensible answer to GDPR storage limitation (Art. 5(1)(e)): a
 * stated, finite window with a business reason, not indefinite retention by
 * default, which is what "we just never delete backups" actually is.
 */
export const DEFAULT_BACKUP_RETENTION_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The configured window. Env-driven for the reason in the header: the box is the
 * enforcer, and an operator who tunes `restic forget` there must be able to make
 * this page agree without a deploy. A non-positive or unparseable value falls
 * back to the default rather than disabling the sentence — mirrors
 * lib/retention-policy.ts's `positiveInt`.
 */
export function backupRetentionDays(): number {
  const n = Number(process.env.BACKUP_RETENTION_DAYS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BACKUP_RETENTION_DAYS;
}

/** Why this tenant's data is being KEPT rather than merely backed up. */
export type RetentionReason =
  /** The free period ended and no subscription took over. The owner's case. */
  | "trialLapsed"
  /** The registry entry is retired — the tenant was torn down. */
  | "deprovisioned"
  /** No registry entry at all: we hold data for a tenant that no longer exists. */
  | "departed";

export type BackupRetentionView =
  /** A live, current tenant. Its backups are operational, not an archive — there
   *  is no "until" to state, and inventing one would read as a deadline. */
  | { kind: "notApplicable" }
  /** We hold it, and here is the date it goes. */
  | { kind: "retained"; reason: RetentionReason; until: Date; daysLeft: number }
  /** Past the window. The box has probably already pruned it; say so rather than
   *  quote a date in the past as if it were a promise. */
  | { kind: "expired"; reason: RetentionReason; until: Date }
  /** Gone or never taken. The honest answer to "do you still have our menu?" is
   *  no, and it must not be dressed up as a retention window. */
  | { kind: "nothingHeld"; reason: RetentionReason };

export type RetentionFacts = {
  /** The registry `status:` for this slug, or null when it has no entry. */
  registryStatus: string | null;
  /** `TenantBilling.trialEndsAt`, if this slug has a plan. */
  trialEndsAt: Date | null;
  /** True when a subscription is ACTIVE — a paying tenant is never "lapsed",
   *  whatever its trial column still says. Derived by the caller from the same
   *  rows /admin/billing renders, so the two cannot disagree. */
  paying: boolean;
  /** The newest artifact we hold, or null when we hold none. */
  newestTakenAt: Date | null;
};

/** Registry statuses that mean the tenant is no longer running. */
const RETIRED_STATUSES = new Set(["retired", "deprovisioned", "archived"]);

/**
 * Why we would be keeping this tenant's data — or null when the tenant is simply
 * live and its backups are ordinary operational copies.
 *
 * Order is deliberate. Absence from the registry is the strongest signal (the
 * entry was removed entirely), then an explicitly retired entry, and only then
 * the trial date — because a lapsed trial on a tenant that is still RUNNING is a
 * billing conversation, not an archive, and calling it "departed" would put a
 * deletion date next to a restaurant that is serving lunch right now.
 */
export function retentionReason(facts: RetentionFacts, now: Date): RetentionReason | null {
  if (facts.registryStatus === null) return "departed";
  if (RETIRED_STATUSES.has(facts.registryStatus.toLowerCase())) return "deprovisioned";
  if (facts.paying) return null;
  if (facts.trialEndsAt && facts.trialEndsAt.getTime() <= now.getTime()) return "trialLapsed";
  return null;
}

/** The date the LAST copy we can see ages out. Derived from the newest artifact
 *  because that is the one that expires last — quoting the oldest would tell a
 *  returning restaurant their data is gone while we still hold it. */
export function retainedUntil(newestTakenAt: Date, retentionDays: number): Date {
  return new Date(newestTakenAt.getTime() + retentionDays * DAY_MS);
}

/**
 * The whole sentence, as data. There is no other source for it.
 */
export function backupRetentionView(
  facts: RetentionFacts,
  now: Date,
  retentionDays: number,
): BackupRetentionView {
  const reason = retentionReason(facts, now);
  if (!reason) return { kind: "notApplicable" };
  if (!facts.newestTakenAt) return { kind: "nothingHeld", reason };

  const until = retainedUntil(facts.newestTakenAt, retentionDays);
  if (until.getTime() <= now.getTime()) return { kind: "expired", reason, until };
  return {
    kind: "retained",
    reason,
    until,
    // Ceiling, so the final partial day reads "1 day left" rather than "0" —
    // same rule as lib/trial.ts, and for the same reason: a countdown that hits
    // zero while the thing still exists is read as "already gone".
    daysLeft: Math.ceil((until.getTime() - now.getTime()) / DAY_MS),
  };
}
