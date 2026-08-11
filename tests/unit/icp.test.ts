import { describe, expect, it } from "vitest";
import { clampQuarter, quarterRange, toIcpCsv, toIcpLines, type IcpLine } from "@/lib/icp";

describe("quarterRange", () => {
  it("covers each quarter in UTC", () => {
    expect(quarterRange(2026, 1)).toEqual({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(quarterRange(2026, 4)).toEqual({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
  });

  it("uses an EXCLUSIVE upper bound, so nothing on the last day is dropped", () => {
    // The trap this avoids: an inclusive "last day of the quarter" bound silently
    // loses every invoice issued after 00:00 on 31 March — which, for a filing,
    // means under-reporting a quarter and only finding out later.
    const { to } = quarterRange(2026, 1);
    expect(to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(new Date("2026-03-31T23:59:59.000Z") < to).toBe(true);
  });

  it("rolls Q4 into the next year rather than producing month 12", () => {
    expect(quarterRange(2026, 4).to.getUTCFullYear()).toBe(2027);
  });
});

describe("clampQuarter", () => {
  it("passes real quarters through", () => {
    for (const q of [1, 2, 3, 4]) expect(clampQuarter(q)).toBe(q);
  });

  it("TRUNCATES a fractional quarter instead of passing it on", () => {
    // A bare min/max clamp lets 2.5 through, and Date.UTC then truncates month
    // 4.5 to May rather than erroring — so the window silently becomes May–July,
    // dropping April and double-counting July against Q3, while the filename
    // still says Q2.
    expect(clampQuarter(2.5)).toBe(2);
    expect(quarterRange(2026, clampQuarter(2.5))).toEqual({
      from: new Date("2026-04-01T00:00:00.000Z"),
      to: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("clamps out-of-range and nonsense values to a real quarter", () => {
    expect(clampQuarter(0)).toBe(1);
    expect(clampQuarter(-3)).toBe(1);
    expect(clampQuarter(9)).toBe(4);
    expect(clampQuarter(Number.NaN)).toBe(1);
    expect(clampQuarter(Number.POSITIVE_INFINITY)).toBe(4);
  });
});

describe("toIcpLines", () => {
  const inv = (vatNumber: string | null, netCents: number, countryCode = "FR") => ({
    buyerSnapshot: { vatNumber, countryCode },
    netCents,
  });

  it("gives one line per VAT number, summing the net", () => {
    // The Belastingdienst wants one row per counterparty per period, not one per
    // invoice — and the NET, because a reverse charge means no VAT was charged.
    expect(toIcpLines([inv("FR27981106214", 5000), inv("FR27981106214", 2500)])).toEqual([
      { vatNumber: "FR27981106214", countryCode: "FR", netCents: 7500, invoiceCount: 2 },
    ]);
  });

  it("keeps different customers apart and sorts them stably", () => {
    const lines = toIcpLines([inv("DE111", 100, "DE"), inv("AT999", 200, "AT")]);
    expect(lines.map((l) => l.vatNumber)).toEqual(["AT999", "DE111"]);
  });

  it("skips an invoice with no VAT number rather than inventing one", () => {
    // A reverse charge requires a number, so this shape is a contradiction. It is
    // dropped here and surfaced as a COUNT MISMATCH by the page — silently
    // including it under an empty key would be the worst of both.
    const lines = toIcpLines([inv(null, 5000), inv("FR1", 100)]);
    expect(lines).toHaveLength(1);
    expect(lines.reduce((n, l) => n + l.invoiceCount, 0)).toBe(1);
  });

  it("skips a whitespace-only VAT number too", () => {
    expect(toIcpLines([inv("   ", 5000)])).toHaveLength(0);
  });

  it("survives a snapshot that is missing or malformed", () => {
    expect(toIcpLines([{ buyerSnapshot: null, netCents: 1 }])).toEqual([]);
    expect(toIcpLines([{ buyerSnapshot: undefined, netCents: 1 }])).toEqual([]);
  });

  it("falls back to the VAT prefix when the snapshot carries no country", () => {
    expect(
      toIcpLines([{ buyerSnapshot: { vatNumber: "BE0123456789" }, netCents: 100 }])[0].countryCode,
    ).toBe("BE");
  });
});

describe("toIcpCsv", () => {
  const line = (over: Partial<IcpLine> = {}): IcpLine => ({
    countryCode: "FR",
    vatNumber: "FR27981106214",
    netCents: 7500,
    invoiceCount: 2,
    ...over,
  });

  it("writes a header and decimal EUR, not cents", () => {
    // The filing form takes euros. Handing an accountant a column of cents is a
    // silent factor-of-100 waiting to be typed in.
    expect(toIcpCsv([line()])).toBe(
      "country,vat_number,net_eur,invoices\r\nFR,FR27981106214,75.00,2\r\n",
    );
  });

  it("keeps two decimals on a whole amount", () => {
    expect(toIcpCsv([line({ netCents: 10000 })])).toContain(",100.00,");
  });

  it("still emits the header when there is nothing to report", () => {
    // An empty file and a missing file look the same to a human; a header alone
    // says "asked, and the answer was none".
    expect(toIcpCsv([])).toBe("country,vat_number,net_eur,invoices\r\n");
  });

  it("quotes a value that would otherwise break the row", () => {
    // Nothing in a VAT number should need this, but a CSV writer that trusts its
    // input is a CSV writer that eventually corrupts a filing.
    expect(toIcpCsv([line({ vatNumber: 'FR"1,2' })])).toContain('"FR""1,2"');
  });

  it("uses CRLF, which is what spreadsheet software expects", () => {
    expect(toIcpCsv([line()]).endsWith("\r\n")).toBe(true);
  });
});
