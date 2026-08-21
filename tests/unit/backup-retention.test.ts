import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  backupRetentionDays,
  backupRetentionView,
  retainedUntil,
  retentionReason,
} from "@/lib/backup-retention";

// The sentence the whole feature exists for: what a returning restaurant is
// told. Getting it wrong in one direction tells a customer their menu is gone
// while we still hold it; in the other it promises data we have already pruned.

const NOW = new Date("2026-08-21T09:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const DAYS = 180;

const base = {
  registryStatus: "active" as string | null,
  trialEndsAt: null as Date | null,
  paying: false,
  newestTakenAt: daysAgo(1) as Date | null,
};

afterEach(() => {
  delete process.env.BACKUP_RETENTION_DAYS;
});

describe("backupRetentionDays", () => {
  it("defaults to six months", () => {
    expect(backupRetentionDays()).toBe(DEFAULT_BACKUP_RETENTION_DAYS);
  });

  it("takes a positive integer override — the box's policy is the real one", () => {
    process.env.BACKUP_RETENTION_DAYS = "365";
    expect(backupRetentionDays()).toBe(365);
  });

  it("falls back rather than disabling the sentence on nonsense", () => {
    for (const bad of ["0", "-5", "ninety", "", "12.5"]) {
      process.env.BACKUP_RETENTION_DAYS = bad;
      expect(backupRetentionDays()).toBe(DEFAULT_BACKUP_RETENTION_DAYS);
    }
  });
});

describe("retentionReason", () => {
  it("a live tenant has none — its backups are operational, not an archive", () => {
    expect(retentionReason(base, NOW)).toBeNull();
  });

  it("no registry entry at all is `departed`, the strongest signal", () => {
    expect(retentionReason({ ...base, registryStatus: null }, NOW)).toBe("departed");
  });

  it("a retired entry is `deprovisioned`, case-insensitively", () => {
    expect(retentionReason({ ...base, registryStatus: "RETIRED" }, NOW)).toBe("deprovisioned");
    expect(retentionReason({ ...base, registryStatus: "deprovisioned" }, NOW)).toBe(
      "deprovisioned",
    );
  });

  it("a lapsed trial on a still-running tenant is `trialLapsed`", () => {
    expect(retentionReason({ ...base, trialEndsAt: daysAgo(3) }, NOW)).toBe("trialLapsed");
  });

  it("a trial still running is NOT a retention case", () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(retentionReason({ ...base, trialEndsAt: future }, NOW)).toBeNull();
  });

  it("a PAYING tenant is never lapsed, whatever the trial column still says", () => {
    // Derived from the same subscription rows /admin/billing renders, so a
    // customer who converted is never shown a deletion date.
    expect(retentionReason({ ...base, trialEndsAt: daysAgo(3), paying: true }, NOW)).toBeNull();
  });

  it("a torn-down tenant outranks its own billing state", () => {
    expect(
      retentionReason({ ...base, registryStatus: "retired", paying: true }, NOW),
    ).toBe("deprovisioned");
  });
});

describe("retainedUntil", () => {
  it("counts from the NEWEST artifact — the one that expires last", () => {
    expect(retainedUntil(new Date("2026-01-01T00:00:00.000Z"), 180)).toEqual(
      new Date("2026-06-30T00:00:00.000Z"),
    );
  });
});

describe("backupRetentionView", () => {
  it("says nothing for a live tenant", () => {
    expect(backupRetentionView(base, NOW, DAYS)).toEqual({ kind: "notApplicable" });
  });

  it("gives a lapsed trial a date and a countdown", () => {
    const view = backupRetentionView(
      { ...base, trialEndsAt: daysAgo(10), newestTakenAt: daysAgo(10) },
      NOW,
      DAYS,
    );
    expect(view).toMatchObject({ kind: "retained", reason: "trialLapsed", daysLeft: 170 });
  });

  it("counts the final partial day as one, never zero", () => {
    // A countdown that reads 0 while the data still exists is read as "gone".
    const newest = new Date(NOW.getTime() - (DAYS * 24 - 1) * 60 * 60 * 1000);
    const view = backupRetentionView(
      { ...base, registryStatus: null, newestTakenAt: newest },
      NOW,
      DAYS,
    );
    expect(view).toMatchObject({ kind: "retained", daysLeft: 1 });
  });

  it("is `expired` once the window has closed", () => {
    const view = backupRetentionView(
      { ...base, registryStatus: null, newestTakenAt: daysAgo(DAYS + 1) },
      NOW,
      DAYS,
    );
    expect(view).toMatchObject({ kind: "expired", reason: "departed" });
  });

  it("holding NOTHING is never dressed up as a retention window", () => {
    // The honest answer to "do you still have our menu?" is no.
    const view = backupRetentionView(
      { ...base, registryStatus: null, newestTakenAt: null },
      NOW,
      DAYS,
    );
    expect(view).toEqual({ kind: "nothingHeld", reason: "departed" });
  });
});
