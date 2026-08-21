import { describe, expect, it } from "vitest";
import {
  backupBoxQuerySchema,
  backupInventorySchema,
  backupJobResultSchema,
} from "@/lib/backup-contract";

// The wire contract both children code against. Tested here rather than only in
// the E2E suite because the box-side agent is built in another repository: a
// silently loosened field here is a defect nobody sees until a real inventory
// arrives shaped differently from the one the page was built for.

const artifact = {
  tenantSlug: "obresse",
  kind: "scheduled",
  takenAt: "2026-08-20T03:00:00.000Z",
  sizeBytes: 18_874_368,
  location: "restic",
  ref: "9f2c1ab4",
  sha256: null,
};

describe("backupInventorySchema", () => {
  it("accepts a well-formed whole-box push and coerces ISO dates", () => {
    const parsed = backupInventorySchema.parse({
      box: "staging",
      reportedAt: "2026-08-20T03:05:00.000Z",
      artifacts: [artifact],
    });
    expect(parsed.reportedAt).toBeInstanceOf(Date);
    expect(parsed.artifacts[0].takenAt).toBeInstanceOf(Date);
    expect(parsed.artifacts[0].sizeBytes).toBe(18_874_368);
  });

  it("accepts an EMPTY inventory — that is a report, not silence", () => {
    // An emptied repository must be expressible. The ingest prunes on it, which
    // is what makes a repository that has quietly emptied visible at all.
    const parsed = backupInventorySchema.parse({
      box: "prod",
      reportedAt: "2026-08-20T03:05:00.000Z",
      artifacts: [],
    });
    expect(parsed.artifacts).toEqual([]);
  });

  it("refuses a slug that is not a registry slug", () => {
    for (const tenantSlug of ["Obresse", "../etc", "ob resse", "-lead", ""]) {
      const res = backupInventorySchema.safeParse({
        box: "staging",
        reportedAt: "2026-08-20T03:05:00.000Z",
        artifacts: [{ ...artifact, tenantSlug }],
      });
      expect(res.success).toBe(false);
    }
  });

  it("refuses a kind or a location outside the agreed vocabulary", () => {
    expect(
      backupInventorySchema.safeParse({
        box: "staging",
        reportedAt: "2026-08-20T03:05:00.000Z",
        artifacts: [{ ...artifact, kind: "nightly" }],
      }).success,
    ).toBe(false);
    expect(
      backupInventorySchema.safeParse({
        box: "staging",
        reportedAt: "2026-08-20T03:05:00.000Z",
        artifacts: [{ ...artifact, location: "s3" }],
      }).success,
    ).toBe(false);
  });

  it("refuses a garbled size rather than rendering it", () => {
    for (const sizeBytes of [-1, 1.5, 9_999_999_999_999]) {
      expect(
        backupInventorySchema.safeParse({
          box: "staging",
          reportedAt: "2026-08-20T03:05:00.000Z",
          artifacts: [{ ...artifact, sizeBytes }],
        }).success,
      ).toBe(false);
    }
  });

  it("refuses a checksum that is not 64 lowercase hex characters", () => {
    expect(
      backupInventorySchema.safeParse({
        box: "staging",
        reportedAt: "2026-08-20T03:05:00.000Z",
        artifacts: [{ ...artifact, sha256: "not-a-digest" }],
      }).success,
    ).toBe(false);
    expect(
      backupInventorySchema.safeParse({
        box: "staging",
        reportedAt: "2026-08-20T03:05:00.000Z",
        artifacts: [{ ...artifact, sha256: "a".repeat(64) }],
      }).success,
    ).toBe(true);
  });

  it("caps the payload so one POST cannot become a memory event", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ ...artifact, ref: `r${i}` }));
    expect(
      backupInventorySchema.safeParse({
        box: "staging",
        reportedAt: "2026-08-20T03:05:00.000Z",
        artifacts: many,
      }).success,
    ).toBe(false);
  });
});

describe("backupJobResultSchema", () => {
  it("accepts a failure with a reason and no artifact", () => {
    const parsed = backupJobResultSchema.parse({ ok: false, error: "pg_dump exited 1" });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("pg_dump exited 1");
  });

  it("accepts a success carrying the artifact it produced", () => {
    const parsed = backupJobResultSchema.parse({ ok: true, artifact });
    expect(parsed.artifact?.tenantSlug).toBe("obresse");
  });

  it("requires the verdict itself", () => {
    expect(backupJobResultSchema.safeParse({ error: "boom" }).success).toBe(false);
  });

  it("bounds the error text — it is stored and rendered", () => {
    expect(backupJobResultSchema.safeParse({ ok: false, error: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});

describe("backupBoxQuerySchema", () => {
  it("requires a box on the job poll", () => {
    expect(backupBoxQuerySchema.safeParse(null).success).toBe(false);
    expect(backupBoxQuerySchema.safeParse("").success).toBe(false);
    expect(backupBoxQuerySchema.parse(" staging ")).toBe("staging");
  });
});
