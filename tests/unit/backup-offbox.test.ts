import { describe, expect, it } from "vitest";
import { OFFBOX_EXPECTED_AFTER_HOURS, offBoxMissing } from "@/lib/backup-offbox";

// "Are this tenant's dumps LEAVING the box?" — the question a page full of green
// ages cannot answer, and the one this module exists for. Re-armed 2026-08-21
// once the box agent began enumerating the restic repository (deploy #139);
// before that it was permanently true for everyone, which is why ADR-014 D5 had
// removed it from the alarm.

const NOW = new Date("2026-08-21T09:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const OVER = OFFBOX_EXPECTED_AFTER_HOURS + 1;

describe("offBoxMissing", () => {
  it("is silent for a tenant whose off-box copy arrived on the last nightly ship", () => {
    expect(
      offBoxMissing(
        {
          artifactCount: 4,
          newestTakenAt: hoursAgo(6),
          newestOffBoxTakenAt: hoursAgo(25),
          oldestTakenAt: hoursAgo(200),
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("fires when the dumps keep arriving and nothing has left the box", () => {
    // THE CASE NOTHING ELSE CATCHES: every age rule on the page reads green while
    // nothing has been shipped since Monday.
    expect(
      offBoxMissing(
        {
          artifactCount: 9,
          newestTakenAt: hoursAgo(5),
          newestOffBoxTakenAt: hoursAgo(OVER),
          oldestTakenAt: hoursAgo(300),
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("stays SILENT for a stale tenant — its red line must not be doubled", () => {
    // Nothing has been dumped for two days, so nothing has shipped either. That
    // is one problem, `stale`/`unprotected` already says it, and a second line
    // saying it in other words is how a mail gets filtered.
    expect(
      offBoxMissing(
        {
          artifactCount: 3,
          newestTakenAt: hoursAgo(48),
          newestOffBoxTakenAt: hoursAgo(48),
          oldestTakenAt: hoursAgo(300),
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("is exclusive at the boundary — exactly 30h is still within the cycle", () => {
    const at = (h: number) =>
      offBoxMissing(
        {
          artifactCount: 2,
          newestTakenAt: hoursAgo(1),
          newestOffBoxTakenAt: hoursAgo(h),
          oldestTakenAt: hoursAgo(300),
        },
        NOW,
      );
    expect(at(OFFBOX_EXPECTED_AFTER_HOURS)).toBe(false);
    expect(at(OVER)).toBe(true);
  });

  it("gives a NEW tenant its first night before accusing it of anything", () => {
    // Provisioned two hours ago: one dump, no off-box copy, and the ship has not
    // run yet. Alarming here is how an alarm gets muted before it has ever been
    // right.
    expect(
      offBoxMissing(
        {
          artifactCount: 1,
          newestTakenAt: hoursAgo(2),
          newestOffBoxTakenAt: null,
          oldestTakenAt: hoursAgo(2),
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("fires for a tenant that has NEVER had a copy leave the box", () => {
    // Same shape, one day later: there has been something worth shipping for
    // longer than a cycle, it is still being dumped, and nothing has shipped.
    expect(
      offBoxMissing(
        {
          artifactCount: 3,
          newestTakenAt: hoursAgo(3),
          newestOffBoxTakenAt: null,
          oldestTakenAt: hoursAgo(OVER),
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("says nothing about a tenant we hold no artifact for", () => {
    expect(
      offBoxMissing(
        { artifactCount: 0, newestTakenAt: null, newestOffBoxTakenAt: null, oldestTakenAt: null },
        NOW,
      ),
    ).toBe(false);
  });
});
