import { describe, expect, it } from "vitest";
import {
  COMMISSION_FLOOR_CENTS,
  COMMISSION_MODE_SAVING_CENTS,
  DEFAULT_COMMISSION_BPS,
  MAX_COMMISSION_BPS,
  asPaymentsMode,
  crossoverCentsPerMonth,
  formatCommissionPercent,
  isCommissionBps,
  paymentsModeQuote,
} from "@/lib/payments-pricing";
import { MODULES } from "@/lib/module-catalog";

// The online-payments list price this whole file measures against — read out of
// the SAME catalog paymentsModeQuote reads, never hardcoded, so a future price
// change cannot make this suite pass against a number nobody actually charges.
const ONLINE_PAYMENTS_PRICE_CENTS = MODULES.find((m) => m.id === "online-payments")!.priceCents;

describe("isCommissionBps", () => {
  it("rejects negative rates — a negative fee is not a rate, it is a bug", () => {
    expect(isCommissionBps(-1)).toBe(false);
    expect(isCommissionBps(-150)).toBe(false);
  });

  it("rejects anything above the 1000 bps (10%) ceiling", () => {
    expect(isCommissionBps(1001)).toBe(false);
    expect(isCommissionBps(5000)).toBe(false);
  });

  // The boundary test: `>` vs `>=` at the ceiling is otherwise indistinguishable
  // from any other passing case, so 1000 itself has to be asserted explicitly.
  it("accepts exactly 1000 bps — the ceiling itself is a valid rate, not the first refusal", () => {
    expect(isCommissionBps(MAX_COMMISSION_BPS)).toBe(true);
    expect(MAX_COMMISSION_BPS).toBe(1000);
  });

  it("accepts 0 (no commission) and the shipped default", () => {
    expect(isCommissionBps(0)).toBe(true);
    expect(isCommissionBps(DEFAULT_COMMISSION_BPS)).toBe(true);
    expect(DEFAULT_COMMISSION_BPS).toBe(150);
  });

  it("rejects a fractional rate — provision-tenant.sh parses the registry field with ^[0-9]+$", () => {
    expect(isCommissionBps(1.5)).toBe(false);
    expect(isCommissionBps(150.001)).toBe(false);
  });
});

// The reduced FLOOR the owner decided on 2026-09-05 (workspace BACKLOG): under
// `commission` the module is €9/mo, not €0. Pinned as literals here on purpose —
// re-deriving them from the same constants the code uses would make this suite
// agree with any floor at all, including the €0 it replaced.
describe("the commission floor", () => {
  it("prices the online-payments module at €9/mo under commission, not €0", () => {
    expect(COMMISSION_FLOOR_CENTS).toBe(900);
  });

  it("saves a tenant exactly €10/mo — the €19 list price less the €9 floor", () => {
    expect(COMMISSION_MODE_SAVING_CENTS).toBe(1000);
    expect(COMMISSION_MODE_SAVING_CENTS).toBe(ONLINE_PAYMENTS_PRICE_CENTS - COMMISSION_FLOOR_CENTS);
    // The floor is a REDUCTION, never a zeroing: the saving must not be the
    // whole list price, which is exactly what it was before the floor existed.
    expect(COMMISSION_MODE_SAVING_CENTS).not.toBe(ONLINE_PAYMENTS_PRICE_CENTS);
  });
});

describe("paymentsModeQuote", () => {
  it("leaves a flat-mode quote unchanged, module present or not", () => {
    expect(paymentsModeQuote(4500, "flat", true)).toBe(4500);
    expect(paymentsModeQuote(4500, "flat", false)).toBe(4500);
  });

  it("reduces the online-payments line to the €9 floor under commission — it does not remove it", () => {
    const withModule = 1900 + ONLINE_PAYMENTS_PRICE_CENTS;
    expect(paymentsModeQuote(withModule, "commission", true)).toBe(
      withModule - ONLINE_PAYMENTS_PRICE_CENTS + COMMISSION_FLOOR_CENTS,
    );
    // Stated as an absolute figure too, so a mistake in BOTH the code and the
    // arithmetic above cannot cancel out: core €19 + online-payments €19 = €38,
    // and commission takes €10 off it, not €19.
    expect(paymentsModeQuote(3800, "commission", true)).toBe(2800);
  });

  it("leaves a tenant without the module unaffected by commission mode — nothing to subtract", () => {
    // A tenant that never bought online-payments has no line to zero: subtracting
    // the module's price anyway would UNDER-charge them for modules they do carry.
    expect(paymentsModeQuote(3600, "commission", false)).toBe(3600);
  });
});

describe("crossoverCentsPerMonth", () => {
  it("returns null at 0 bps — commission is free forever, not merely a high crossover", () => {
    expect(crossoverCentsPerMonth(0)).toBeNull();
    expect(crossoverCentsPerMonth(0, 1900)).toBeNull();
  });

  // THE number every switching surface prints, and the one the floor moved.
  // Hand-derived: turnover * (bps/10000) = savingCents => turnover =
  // savingCents*10000/bps. At the shipped default (150 bps) against the €10 the
  // module actually drops by (€19 -> the €9 floor), that is 1000*10000/150 =
  // 66666.67, rounded to the nearest cent: about €667/mo of online turnover.
  it("computes the shipped figure: 150 bps against the €10 the floor leaves to earn back", () => {
    expect(crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS)).toBe(66667);
  });

  // The regression this whole slice exists to prevent. Against the FULL €19 list
  // price the same rate reads €1,267 — a confident wrong number, 1.9x too high,
  // on the page where a restaurant commits money. The default argument is what
  // makes the wrong basis unreachable from a UI caller, so it is asserted
  // rather than assumed.
  it("defaults to the SAVING, never the full list price — €667, not €1,267", () => {
    expect(crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS)).toBe(
      crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS, COMMISSION_MODE_SAVING_CENTS),
    );
    expect(crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS)).not.toBe(
      crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS, ONLINE_PAYMENTS_PRICE_CENTS),
    );
    expect(crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS, ONLINE_PAYMENTS_PRICE_CENTS)).toBe(126667);
  });

  // A second, exact (non-repeating) example so the formula itself — not just its
  // rounding — is pinned: 100 bps (1%) of 100000 cents (€1000) is exactly 1000
  // cents (€10), so the crossover for a €10 flat fee at 1% is exactly €1000/mo.
  it("computes an exact round-number crossover with no rounding involved", () => {
    expect(crossoverCentsPerMonth(100, 1000)).toBe(100000);
  });
});

describe("formatCommissionPercent", () => {
  it("formats the shipped default at two decimal places", () => {
    expect(formatCommissionPercent(DEFAULT_COMMISSION_BPS)).toBe("1.50%");
  });

  it("keeps two decimals even for a whole percent", () => {
    expect(formatCommissionPercent(100)).toBe("1.00%");
  });

  it("does not collapse the finest rate (1 bp) to 0.0%", () => {
    expect(formatCommissionPercent(1)).toBe("0.01%");
  });

  it("formats 0 as a real 0.00%, not an empty string", () => {
    expect(formatCommissionPercent(0)).toBe("0.00%");
  });
});

describe("asPaymentsMode", () => {
  it("reads the literal 'commission' as commission", () => {
    expect(asPaymentsMode("commission")).toBe("commission");
  });

  it("reads 'flat' as flat", () => {
    expect(asPaymentsMode("flat")).toBe("flat");
  });

  it("reads anything else as flat — the safe default for a value that should never occur", () => {
    expect(asPaymentsMode("")).toBe("flat");
    expect(asPaymentsMode("COMMISSION")).toBe("flat");
    expect(asPaymentsMode("garbage")).toBe("flat");
  });
});
