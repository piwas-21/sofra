import { describe, expect, it } from "vitest";
import {
  BUNDLES,
  MODULES,
  MODULE_IDS,
  isModuleId,
  quoteModules,
  unknownModuleIds,
} from "@/lib/module-catalog";

describe("catalog shape", () => {
  it("prices every module id exactly once, in whole cents", () => {
    expect(MODULES.map((m) => m.id).sort()).toEqual([...MODULE_IDS].sort());
    for (const m of MODULES) {
      expect(Number.isInteger(m.priceCents)).toBe(true);
      expect(m.priceCents).toBeGreaterThan(0);
    }
  });

  it("only bundles modules that exist, and always includes core", () => {
    for (const b of BUNDLES) {
      expect(unknownModuleIds([...b.modules])).toEqual([]);
      expect(b.modules).toContain("core");
    }
  });

  it("prices every bundle below the sum of its parts", () => {
    // A bundle that costs more than its parts would never be chosen by
    // quoteModules — it would be dead config that still reads like an offer.
    for (const b of BUNDLES) {
      const parts = b.modules.reduce(
        (sum, id) => sum + (MODULES.find((m) => m.id === id)?.priceCents ?? 0),
        0,
      );
      expect(b.priceCents).toBeLessThan(parts);
    }
  });
});

describe("isModuleId / unknownModuleIds", () => {
  it("accepts catalog ids and rejects anything else", () => {
    expect(isModuleId("core")).toBe(true);
    expect(isModuleId("kitchen")).toBe(false); // near-miss of kitchen-board
    expect(unknownModuleIds(["core", "loyalty"])).toEqual([]);
    expect(unknownModuleIds(["core", "kitchen", "pos"])).toEqual([
      "kitchen",
      "pos",
    ]);
  });
});

describe("quoteModules", () => {
  it("charges core alone at the core price", () => {
    expect(quoteModules(["core"])).toMatchObject({
      monthlyCents: 1900,
      bundle: null,
      extras: [],
    });
  });

  it("adds core to a selection that forgot it — every instance runs it", () => {
    expect(quoteModules(["reservations"]).monthlyCents).toBe(1900 + 900);
  });

  it("uses a bundle when the selection contains all of it", () => {
    const q = quoteModules(["core", "kitchen-board", "cashier", "printing"]);
    expect(q.bundle).toBe("counter");
    expect(q.monthlyCents).toBe(4500);
    expect(q.aLaCarteCents).toBe(5200);
  });

  it("prefers the cheaper packaging when both bundles apply", () => {
    const q = quoteModules([
      "core",
      "kitchen-board",
      "cashier",
      "printing",
      "server",
      "reservations",
      "loyalty",
    ]);
    expect(q.bundle).toBe("full-service");
    expect(q.monthlyCents).toBe(6900);
  });

  it("bills extras on top of the bundle", () => {
    const q = quoteModules([
      "core",
      "kitchen-board",
      "cashier",
      "printing",
      "extra-languages",
    ]);
    expect(q.bundle).toBe("counter");
    expect(q.extras).toEqual(["extra-languages"]);
    expect(q.monthlyCents).toBe(4500 + 500);
  });

  it("never charges a bundle to a selection that is cheaper à la carte", () => {
    // Counter minus printing: no bundle qualifies, so it stays à la carte and
    // must not be rounded up to the bundle price.
    const q = quoteModules(["core", "kitchen-board", "cashier"]);
    expect(q.bundle).toBeNull();
    expect(q.monthlyCents).toBe(4300);
  });

  it("ignores unknown ids and duplicates rather than double-charging", () => {
    const q = quoteModules(["core", "core", "loyalty", "loyalty", "nonsense"]);
    expect(q.monthlyCents).toBe(1900 + 900);
  });
});
