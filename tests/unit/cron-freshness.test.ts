import { describe, expect, it, vi, beforeEach } from "vitest";

// The DB is the only thing mocked. `cronFreshness` IS the logic under test, and the
// question — "would this have gone red during the six-day outage?" — is answered by
// feeding it the heartbeat rows that outage would have produced (namely, none recent).
const groupBy = vi.fn();
vi.mock("@/lib/db", () => ({ db: { auditLog: { groupBy: (...a: unknown[]) => groupBy(...a) } } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const { cronFreshness, CRON_SWEEPS, recordCronRun, CRON_RAN_ACTION } = await import("@/lib/cron-freshness");
const { audit } = await import("@/lib/audit");

const NOW = new Date("2026-09-04T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const rows = (m: Record<string, Date>) =>
  Object.entries(m).map(([entityId, createdAt]) => ({ entityId, _max: { createdAt } }));

const bySweep = async (m: Record<string, Date>) => {
  groupBy.mockResolvedValueOnce(rows(m));
  const out = await cronFreshness(NOW);
  return Object.fromEntries(out.map((r) => [r.sweep, r]));
};

const ALL_FRESH = {
  "trial-warnings": hoursAgo(2),
  "go-live": hoursAgo(0.2),
  "backup-alerts": hoursAgo(3),
  retention: hoursAgo(5),
};

beforeEach(() => {
  groupBy.mockReset();
  vi.mocked(audit).mockClear();
});

describe("cron freshness", () => {
  it("reports every sweep on time when all have heartbeats inside budget", () => {
    return bySweep(ALL_FRESH).then((r) => {
      expect(Object.values(r).map((x) => x.status)).toEqual(["fresh", "fresh", "fresh", "fresh"]);
    });
  });

  it("goes OVERDUE for the six-day outage — the case it exists for", async () => {
    // 2026-08-24 → 2026-08-30. Every sweep had `considered: 0` throughout, which is
    // exactly why a readout derived from the sweeps' own send-markers would have shown
    // nothing wrong. These are heartbeat rows, so the silence is visible.
    const r = await bySweep({
      "trial-warnings": hoursAgo(6 * 24),
      "go-live": hoursAgo(6 * 24),
      "backup-alerts": hoursAgo(6 * 24),
      retention: hoursAgo(6 * 24),
    });

    expect(Object.values(r).map((x) => x.status)).toEqual(["overdue", "overdue", "overdue", "overdue"]);
  });

  it("distinguishes NEVER RUN from merely stale", async () => {
    // Two different facts that need two different words: a sweep nobody has ever
    // triggered, and one that stopped. Collapsing them tells the reader to go looking
    // in the wrong place.
    const r = await bySweep({ "go-live": hoursAgo(0.1) });

    expect(r["go-live"].status).toBe("fresh");
    expect(r["trial-warnings"].status).toBe("never");
    expect(r["trial-warnings"].lastRunAt).toBeNull();
    expect(r["trial-warnings"].ageMs).toBeNull();
  });

  it("holds each sweep to ITS OWN budget, not one shared threshold", async () => {
    // 3h stale: nothing for a daily sweep, badly overdue for one that runs every 15 min.
    // A single global threshold would have to be wrong for one of them.
    const r = await bySweep({
      "trial-warnings": hoursAgo(3),
      "go-live": hoursAgo(3),
      "backup-alerts": hoursAgo(3),
      retention: hoursAgo(3),
    });

    expect(r["go-live"].status).toBe("overdue");
    expect(r["trial-warnings"].status).toBe("fresh");
    expect(r.retention.status).toBe("fresh");
  });

  it("does not cry on ordinary GitHub schedule drift", async () => {
    // The control for the test above. Scheduled runs routinely drift by tens of minutes;
    // an alarm that fires most days is one nobody reads, and the failure being caught
    // here lasted six DAYS. Each budget is ~2+ missed runs, so a single slip is silent.
    const r = await bySweep({
      "trial-warnings": hoursAgo(25),
      "go-live": hoursAgo(0.6),
      "backup-alerts": hoursAgo(13),
      retention: hoursAgo(25),
    });

    expect(Object.values(r).map((x) => x.status)).toEqual(["fresh", "fresh", "fresh", "fresh"]);
  });

  it("every declared sweep gets a row even with no rows at all", async () => {
    const r = await bySweep({});

    expect(Object.keys(r).sort()).toEqual(Object.keys(CRON_SWEEPS).sort());
    expect(Object.values(r).every((x) => x.status === "never")).toBe(true);
  });

  it("records a heartbeat with the sweep's own counts and no PII", async () => {
    await recordCronRun("trial-warnings", { considered: 0, founderNotices: 0 });

    expect(audit).toHaveBeenCalledWith(null, CRON_RAN_ACTION, "Cron", "trial-warnings", {
      result: { considered: 0, founderNotices: 0 },
    });
  });
});
