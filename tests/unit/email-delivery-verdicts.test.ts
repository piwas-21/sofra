import { describe, expect, it } from "vitest";
import { failedIds, notFlaggedIds } from "@/lib/email-delivery-verdicts";

/**
 * G16's rule, and it is the whole feature: **a record with no row is "nothing recorded", never
 * "delivered"**. These are the two pure readers; the thin query wrappers around them are DB-bound
 * and stay out of the unit suite by the same convention every other module here follows.
 */
describe("failedIds", () => {
  it("reports the ids a failure row was written for", () => {
    expect([...failedIds([{ entityId: "s1" }, { entityId: "s3" }])].sort()).toEqual(["s1", "s3"]);
  });

  /**
   * Only failures are written, and every lead created before G5 has no row at all. Reading those as
   * delivered would be lying about the exact thing this screen exists to report.
   */
  it("treats a record with no row as unknown, not as delivered", () => {
    expect(failedIds([])).toEqual(new Set());
  });

  /**
   * `entityId` is nullable on AuditLog. A null in the set matches nothing and looks like it works,
   * which is why it is dropped here rather than at the call site.
   */
  it("drops a row with no entity id instead of poisoning the set", () => {
    const ids = failedIds([{ entityId: null }, { entityId: "s2" }]);

    expect([...ids]).toEqual(["s2"]);
    expect(ids.has(null as unknown as string)).toBe(false);
  });
});

describe("notFlaggedIds", () => {
  it("reports only an explicit false", () => {
    const ids = notFlaggedIds(
      [
        { entityId: "i1", meta: { emailed: false } },
        { entityId: "i2", meta: { emailed: true } },
      ],
      "emailed",
    );

    expect([...ids]).toEqual(["i1"]);
  });

  /**
   * The flag was added to an action that already existed, so an older invoice genuinely does not
   * know whether its mail went. A red badge on every historical invoice trains the founder to
   * ignore the column.
   */
  it("does not invent a failure for a row written before the flag existed", () => {
    const rows = [
      { entityId: "i1", meta: {} },
      { entityId: "i2", meta: null },
      { entityId: "i3", meta: { number: "2026-001" } },
      { entityId: "i4" },
    ];

    expect(notFlaggedIds(rows, "emailed")).toEqual(new Set());
  });

  /** The flag is a parameter because the second caller reads `customerNotified`, not `emailed`. */
  it("reads the flag it was asked for and no other", () => {
    const rows = [
      { entityId: "p1", meta: { customerNotified: false, emailed: true } },
      { entityId: "p2", meta: { customerNotified: true, emailed: false } },
    ];

    expect([...notFlaggedIds(rows, "customerNotified")]).toEqual(["p1"]);
    expect([...notFlaggedIds(rows, "emailed")]).toEqual(["p2"]);
  });

  it("ignores a row with no entity id rather than crashing on it", () => {
    expect(notFlaggedIds([{ entityId: null, meta: { emailed: false } }], "emailed")).toEqual(new Set());
  });
});
