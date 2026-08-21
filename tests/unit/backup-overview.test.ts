import { describe, expect, it } from "vitest";
import { buildBackupOverview, type ArtifactFact } from "@/lib/backup-overview";

// The page, as data. The property that matters most is that a tenant the
// registry knows and we hold NOTHING for is present in the output — the whole
// point of the page is the row that would otherwise be absent.

const NOW = new Date("2026-08-21T09:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const daysAgo = (d: number) => hoursAgo(d * 24);

const artifact = (over: Partial<ArtifactFact> & { tenantSlug: string }): ArtifactFact => ({
  box: "staging",
  location: "RESTIC",
  takenAt: hoursAgo(6),
  sizeBytes: 1024n,
  ...over,
});

const registry = (slug: string, over: Partial<{ status: string; box: string }> = {}) => ({
  slug,
  name: `${slug} Restaurant`,
  status: "active",
  box: "staging",
  ...over,
});

const boxes = [{ box: "staging", reportedAt: hoursAgo(1), receivedAt: hoursAgo(1) }];

const build = (input: Partial<Parameters<typeof buildBackupOverview>[0]> = {}) =>
  buildBackupOverview({
    registry: [],
    artifacts: [],
    plans: [],
    boxReports: boxes,
    now: NOW,
    retentionDays: 180,
    ...input,
  });

describe("buildBackupOverview", () => {
  it("shows a registry tenant we hold NOTHING for, instead of omitting it", () => {
    const { rows, attention } = build({ registry: [registry("neverbacked")] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "neverbacked", health: "never", artifactCount: 0 });
    expect(attention).toBe(1);
  });

  it("shows a tenant we hold data for that the registry no longer lists", () => {
    // The departed customer. Its absence from the registry is the whole reason
    // the artifact rows are not foreign-keyed to it.
    const { rows } = build({
      artifacts: [artifact({ tenantSlug: "gone", takenAt: daysAgo(3) })],
    });
    expect(rows[0]).toMatchObject({ slug: "gone", name: null, registryStatus: null, box: "staging" });
    expect(rows[0].retention).toMatchObject({ kind: "retained", reason: "departed" });
  });

  it("sorts worst-first, then alphabetically", () => {
    const { rows } = build({
      registry: [registry("aaa-fine"), registry("bbb-empty"), registry("ccc-old")],
      artifacts: [
        artifact({ tenantSlug: "aaa-fine" }),
        artifact({ tenantSlug: "ccc-old", takenAt: hoursAgo(100) }),
      ],
    });
    expect(rows.map((r) => r.slug)).toEqual(["bbb-empty", "ccc-old", "aaa-fine"]);
  });

  it("aggregates count, newest and total size across boxes and locations", () => {
    const { rows } = build({
      registry: [registry("multi")],
      artifacts: [
        artifact({ tenantSlug: "multi", takenAt: hoursAgo(30), sizeBytes: 1000n }),
        artifact({ tenantSlug: "multi", takenAt: hoursAgo(6), sizeBytes: 24n, location: "LOCAL" }),
      ],
    });
    expect(rows[0]).toMatchObject({ artifactCount: 2, offBoxCount: 1, bytes: 1024 });
    expect(rows[0].newestTakenAt).toEqual(hoursAgo(6));
  });

  it("flags a tenant whose only copies live on the box that runs it", () => {
    const { rows } = build({
      registry: [registry("localonly")],
      artifacts: [artifact({ tenantSlug: "localonly", location: "LOCAL" })],
    });
    expect(rows[0]).toMatchObject({ health: "protected", singleSiteOnly: true });
  });

  it("marks every tenant on a quiet box, so a green age is not read as an observation", () => {
    const { rows, quietBoxes } = build({
      registry: [registry("onquiet", { box: "prod" })],
      artifacts: [artifact({ tenantSlug: "onquiet", box: "prod" })],
      boxReports: [{ box: "prod", reportedAt: daysAgo(2), receivedAt: daysAgo(2) }],
    });
    expect(quietBoxes).toBe(1);
    expect(rows[0].boxQuiet).toBe(true);
  });

  it("names the registry's box even for a tenant with no artifacts at all", () => {
    // The `never` row is exactly the one that most needs a box named on it.
    const { rows } = build({ registry: [registry("nobackup", { box: "prod" })] });
    expect(rows[0].box).toBe("prod");
  });

  it("derives the trial sentence from the plan, and stays silent for a payer", () => {
    const input = {
      registry: [registry("lapsed"), registry("payer")],
      artifacts: [
        artifact({ tenantSlug: "lapsed", takenAt: daysAgo(2) }),
        artifact({ tenantSlug: "payer", takenAt: daysAgo(2) }),
      ],
      plans: [
        { tenantSlug: "lapsed", trialEndsAt: daysAgo(20), paying: false },
        { tenantSlug: "payer", trialEndsAt: daysAgo(20), paying: true },
      ],
    };
    const rows = new Map(build(input).rows.map((r) => [r.slug, r]));
    expect(rows.get("lapsed")!.retention).toMatchObject({
      kind: "retained",
      reason: "trialLapsed",
      daysLeft: 178,
    });
    expect(rows.get("payer")!.retention).toEqual({ kind: "notApplicable" });
  });

  it("counts a box's artifacts and reports an empty world without crashing", () => {
    const empty = build();
    expect(empty.rows).toEqual([]);
    expect(empty.attention).toBe(0);
    expect(empty.boxes[0]).toMatchObject({ box: "staging", quiet: false, artifacts: 0 });
  });
});
