import { describe, expect, it } from "vitest";
import {
  BOX_QUIET_AFTER_HOURS,
  STALE_AFTER_HOURS,
  UNPROTECTED_AFTER_HOURS,
  backupHealth,
  boxIsQuiet,
  healthSeverity,
  hoursSince,
  totalBytes,
} from "@/lib/backup-health";

// The rules that decide "this restaurant's data is not protected". Every
// boundary below is pinned deliberately: an off-by-one here renders as calm
// green text, which is the failure mode a backup page must not have.

const NOW = new Date("2026-08-21T09:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("hoursSince", () => {
  it("floors to whole hours", () => {
    expect(hoursSince(hoursAgo(3.9), NOW)).toBe(3);
  });

  it("clamps a FUTURE timestamp to 0 rather than reporting a negative age", () => {
    // A box whose clock runs ahead must not be able to silence a staleness
    // alarm by producing an age that compares as fresher than fresh.
    const future = new Date(NOW.getTime() + 10 * 60 * 60 * 1000);
    expect(hoursSince(future, NOW)).toBe(0);
  });
});

describe("backupHealth", () => {
  const facts = (h: number | null) => ({
    artifactCount: h === null ? 0 : 1,
    newestTakenAt: h === null ? null : hoursAgo(h),
    offBoxCount: h === null ? 0 : 1,
  });

  it("a fresh nightly is protected", () => {
    expect(backupHealth(facts(20), NOW)).toBe("protected");
  });

  it("is still protected exactly AT the stale threshold, not past it", () => {
    // The comparison is `>`: a tenant sitting precisely on 36h has not yet
    // missed anything, and a healthy tenant must not read amber for part of
    // every day — that is how a colour stops meaning anything.
    expect(backupHealth(facts(STALE_AFTER_HOURS), NOW)).toBe("protected");
    expect(backupHealth(facts(STALE_AFTER_HOURS + 1), NOW)).toBe("stale");
  });

  it("escalates to unprotected only past the second threshold", () => {
    expect(backupHealth(facts(UNPROTECTED_AFTER_HOURS), NOW)).toBe("stale");
    expect(backupHealth(facts(UNPROTECTED_AFTER_HOURS + 1), NOW)).toBe("unprotected");
  });

  it("no artifact at all is `never`, not `unprotected`", () => {
    // Different problem, different answer: aged-out means the schedule broke,
    // zero means the tenant was never wired into the backup at all.
    expect(backupHealth(facts(null), NOW)).toBe("never");
  });

  it("a count without a timestamp still reads `never` rather than throwing", () => {
    expect(backupHealth({ artifactCount: 3, newestTakenAt: null, offBoxCount: 0 }, NOW)).toBe(
      "never",
    );
  });

  it("orders severity so the worst sorts first", () => {
    expect(healthSeverity("never")).toBeGreaterThan(healthSeverity("unprotected"));
    expect(healthSeverity("unprotected")).toBeGreaterThan(healthSeverity("stale"));
    expect(healthSeverity("stale")).toBeGreaterThan(healthSeverity("protected"));
  });
});

describe("boxIsQuiet", () => {
  it("a box that has never reported is quiet", () => {
    expect(boxIsQuiet(null, NOW)).toBe(true);
  });

  it("tolerates a reboot or a deploy window", () => {
    expect(boxIsQuiet(hoursAgo(BOX_QUIET_AFTER_HOURS - 1), NOW)).toBe(false);
  });

  it("is quiet at the threshold", () => {
    expect(boxIsQuiet(hoursAgo(BOX_QUIET_AFTER_HOURS), NOW)).toBe(true);
  });
});

describe("totalBytes", () => {
  it("sums as bigint and converts once", () => {
    expect(totalBytes([1024n, 2048n, 1n])).toBe(3073);
  });

  it("is 0 for nothing", () => {
    expect(totalBytes([])).toBe(0);
  });
});
