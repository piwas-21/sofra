import { beforeEach, describe, expect, it, vi } from "vitest";

// The db is the only thing these helpers touch, and what they do with its answer IS the behaviour:
// which ids come back as "recorded failure", and — the part that matters — which do not.
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { auditLog: { findMany: (...args: unknown[]) => findMany(...args) } } }));

const { failedByAction, notEmailedByFlag } = await import("@/lib/email-delivery");

beforeEach(() => {
  findMany.mockReset();
});

describe("failedByAction", () => {
  it("reports the ids a failure row was written for", async () => {
    findMany.mockResolvedValue([{ entityId: "s1" }, { entityId: "s3" }]);

    const failed = await failedByAction("signup.welcome.failed", ["s1", "s2", "s3"]);

    expect([...failed].sort()).toEqual(["s1", "s3"]);
  });

  /**
   * The whole point of the screen: "no row" is NOT "delivered". Only failures are written, and
   * every lead created before G5 has no row at all — a badge that read those as delivered would be
   * lying about the exact thing it exists to report.
   */
  it("treats a record with no row as unknown, not as delivered", async () => {
    findMany.mockResolvedValue([]);

    expect(await failedByAction("signup.welcome.failed", ["s1"])).toEqual(new Set());
  });

  it("asks the database nothing when there is nothing to ask about", async () => {
    expect(await failedByAction("signup.welcome.failed", [])).toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the action and the ids on the page", async () => {
    findMany.mockResolvedValue([]);

    await failedByAction("signup.welcome.failed", ["s1", "s2"]);

    expect(findMany).toHaveBeenCalledWith({
      where: { action: "signup.welcome.failed", entityId: { in: ["s1", "s2"] } },
      select: { entityId: true },
    });
  });
});

describe("notEmailedByFlag", () => {
  it("reports only an explicit false", async () => {
    findMany.mockResolvedValue([
      { entityId: "i1", meta: { emailed: false } },
      { entityId: "i2", meta: { emailed: true } },
    ]);

    expect([...(await notEmailedByFlag("billing.invoice.issued", ["i1", "i2"]))]).toEqual(["i1"]);
  });

  /**
   * `meta.emailed` was added to this action after it already existed, so an older invoice genuinely
   * does not know whether its mail went. Reading a missing flag as a failure would put a red badge
   * on every historical invoice and train the founder to ignore the column.
   */
  it("does not invent a failure for a row written before the flag existed", async () => {
    findMany.mockResolvedValue([
      { entityId: "i1", meta: {} },
      { entityId: "i2", meta: null },
      { entityId: "i3", meta: { number: "2026-001" } },
    ]);

    expect(await notEmailedByFlag("billing.invoice.issued", ["i1", "i2", "i3"])).toEqual(new Set());
  });

  it("ignores a row with no entity id rather than crashing on it", async () => {
    findMany.mockResolvedValue([{ entityId: null, meta: { emailed: false } }]);

    expect(await notEmailedByFlag("billing.invoice.issued", ["i1"])).toEqual(new Set());
  });
});
