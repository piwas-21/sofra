// Is a tenant's data anywhere OTHER than the box that runs it?
//
// Its own module, apart from `backup-health.ts`, because it is a different
// question with a different clock. Health asks "how old is the newest copy";
// this asks "did the newest copies ever LEAVE the box", and the two fail
// independently — a tenant can be dumped perfectly every night for a week while
// nothing has been shipped off box since Monday, and every age rule reads green
// throughout. THAT is the state this module exists to name.
//
// HISTORY, because it explains the shape. This started as
// `isSingleSiteOnly(artifactCount > 0 && offBoxCount === 0)` and was TRUE for
// every tenant on the platform, permanently — not because the copies were on one
// site but because the box agent could not see a restic snapshot at all and
// reported everything it found as `local`. ADR-014 D5 dropped it as an alert
// trigger for that reason. The agent now enumerates the repository
// (deploy #139), so the signal finally means what it says, and this module is
// what re-arms it.

import { hoursSince } from "@/lib/backup-health";

/**
 * **> 30h without an off-box copy ⇒ the ship is not happening.**
 *
 * MEASURED (both boxes, 2026-08-21): each box dumps nightly at 02:15 and the
 * cross-box restic ship runs at 03:00, so a healthy tenant's newest off-box copy
 * is at most ~24h old at any moment. Thirty hours is that cycle plus a six-hour
 * grace — enough to absorb a late dump, a slow ship or clock skew, and not
 * enough to hide a ship that did not run at all.
 *
 * Deliberately SHORTER than the 36h staleness threshold: a missed ship is
 * detectable a night before a missed dump would be, because the dumps keep
 * arriving while nothing leaves.
 */
export const OFFBOX_EXPECTED_AFTER_HOURS = 30;

export type OffBoxFacts = {
  /** How many artifacts we hold for this tenant, anywhere. */
  artifactCount: number;
  /** The newest artifact of any kind — the proof that dumping still works. */
  newestTakenAt: Date | null;
  /** When the newest OFF-BOX (restic) copy was taken, or null if there is none. */
  newestOffBoxTakenAt: Date | null;
  /** When the OLDEST artifact of any kind was taken — the clock for "how long
   *  this tenant has had something worth shipping". */
  oldestTakenAt: Date | null;
};

/**
 * True when this tenant is being dumped and those dumps are not leaving the box.
 *
 * THREE conditions, and each one removes a false alarm the previous version
 * would have raised:
 *
 * 1. There is something to ship at all. A tenant with no artifact is `never`,
 *    already alarmed, and two alarms for one problem is how a reader learns to
 *    skim.
 * 2. Nothing has arrived off box within a ship cycle. When an off-box copy
 *    exists its AGE answers this; when none exists the clock is the tenant's
 *    OLDEST artifact, because a restaurant provisioned two hours ago is not
 *    unprotected, it is waiting for tonight.
 * 3. THE DUMPS THEMSELVES ARE STILL ARRIVING. Without this, every `stale` and
 *    `unprotected` tenant would also report a missing off-box copy — trivially,
 *    since its newest copy is the old one — and every red mail would carry a
 *    second red line saying the same thing in other words. The signal worth
 *    having is the one nothing else can see: green ages, and nothing leaving.
 */
export function offBoxMissing(facts: OffBoxFacts, now: Date): boolean {
  if (facts.artifactCount === 0 || !facts.newestTakenAt) return false;
  if (hoursSince(facts.newestTakenAt, now) > OFFBOX_EXPECTED_AFTER_HOURS) return false;
  const since = facts.newestOffBoxTakenAt ?? facts.oldestTakenAt;
  if (!since) return false;
  return hoursSince(since, now) > OFFBOX_EXPECTED_AFTER_HOURS;
}
