import { describe, expect, it } from "vitest";
import {
  BUNDLES,
  MODULES,
  MODULE_IDS,
  extraLanguageCount,
  isModuleId,
  quoteModules,
  unknownModuleIds,
} from "@/lib/module-catalog";
import { TENANT_LANGUAGES, unknownLanguages } from "@/lib/tenant-options";
import en from "@/messages/en.json";

describe("catalog shape", () => {
  it("prices every module id exactly once, in whole cents", () => {
    expect(MODULES.map((m) => m.id).sort()).toEqual([...MODULE_IDS].sort());
    for (const m of MODULES) {
      expect(Number.isInteger(m.priceCents)).toBe(true);
      expect(m.priceCents).toBeGreaterThan(0);
    }
  });

  it("never bundles a module that is not sellable yet", () => {
    // A bundle is a purchase, so it must not smuggle in a module the à-la-carte surfaces
    // deliberately hide.
    //
    // VACUOUS TODAY, ON PURPOSE: online-payments was the only flagged module and the flag is
    // gone, so `notSellable` is empty and this passes having examined nothing. Kept because the
    // next unfinished module arrives the same way — the id must exist for provisioning to accept
    // it before its surface is built — and this is what stops it being sold inside a bundle.
    // Do not read a green run here as evidence about online-payments; the case below covers that.
    const notSellable = new Set(MODULES.filter((m) => m.sellable === false).map((m) => m.id));
    for (const b of BUNDLES) {
      expect(b.modules.filter((m) => notSellable.has(m))).toEqual([]);
    }
  });

  it("offers online-payments for purchase, now that a tenant can be given it", () => {
    // The inverse of the assertion this replaces. The flag outlived its original reason (the
    // surface being unbuilt): what kept it false to the end was Connect being unconfirmed on the
    // LIVE Stripe platform — `POST /v1/accounts` is provisioning's first call and refuses
    // outright without it, so listing the module would have sold something provisioning could
    // not deliver. Connect confirmed enabled on acct_1TpwTDCHzplJfkIy, 2026-08-10.
    //
    // `not.toBe(false)` rather than `toBeUndefined()`: absent is what the type means by sellable,
    // and pinning the exact absence would fail a future `sellable: true` saying the same thing.
    expect(isModuleId("online-payments")).toBe(true);
    expect(MODULES.find((m) => m.id === "online-payments")?.sellable).not.toBe(false);
  });

  it("names every sellable module in the configurator's messages", () => {
    // The gate the parity check cannot be. `check-message-parity.mjs` diffs the five other
    // locales AGAINST en.json, so a key missing from all six is "in parity" — which is exactly
    // how online-payments reached the live signup page rendering the raw key
    // `signup.configurator.module.online-payments`. Nothing else could have caught it either:
    // SignupConfigurator builds both keys by template literal, so TypeScript never sees them.
    //
    // Anchored on en because parity carries the other five: en having it and the rest missing it
    // is the one shape the parity script does fail on.
    // The two exclusions mirror SignupConfigurator's own filter: extra-languages never appears
    // as a checkbox (the language picker prices it), and core is a fixed line with no hint.
    const { module: labels, moduleHint: hints } = en.signup.configurator;
    for (const m of MODULES) {
      if (m.sellable === false || m.id === "extra-languages") continue;
      expect(labels, `label for ${m.id}`).toHaveProperty(m.id);
      if (m.id === "core") continue;
      expect(hints, `hint for ${m.id}`).toHaveProperty(m.id);
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

describe("tenant languages", () => {
  it("covers exactly the 10 locales the tenant app ships", () => {
    expect(TENANT_LANGUAGES.map((l) => l.code)).toEqual([
      "en",
      "nl",
      "fr",
      "de",
      "it",
      "es",
      "tr",
      "ar",
      "ru",
      "zh",
    ]);
    expect(unknownLanguages(["en", "zh"])).toEqual([]);
    expect(unknownLanguages(["en", "kl", "xx"])).toEqual(["kl", "xx"]);
  });

  it("bills extra-languages only past English + one", () => {
    expect(extraLanguageCount(["en"])).toBe(0);
    expect(extraLanguageCount(["en", "nl"])).toBe(0);
    expect(extraLanguageCount(["en", "nl", "fr"])).toBe(1);
    expect(extraLanguageCount(["en", "nl", "fr", "de"])).toBe(2);
  });

  it("ignores duplicates and unknown codes when counting", () => {
    // The picker can only emit valid codes, but the registry is hand-editable.
    expect(extraLanguageCount(["en", "en", "nl"])).toBe(0);
    expect(extraLanguageCount(["en", "nl", "klingon"])).toBe(0);
  });
});
