// The EC Sales List (Dutch: opgaaf ICP). (SOFRA-BILLING-IDENTITY-PLAN B7.)
//
// A quarterly filing, separate from the VAT return, listing every EU customer's
// VAT number and the total supplied to them. It is only required for supplies
// where the VAT was REVERSE-CHARGED — which is exactly what `taxTreatment`
// records, so the report is a query rather than a reconstruction.
//
// The whole reason this is cheap: the invoice rows already carry the treatment
// the law keys on. Without them it would mean re-deriving each sale's treatment
// from a customer's CURRENT country and VAT status, months later — and both can
// have changed since.

/**
 * A real quarter number, from whatever arrived in the URL.
 *
 * `Math.min(4, Math.max(1, x))` is NOT enough on its own: it passes `2.5`
 * straight through, and `Date.UTC` truncates the resulting month 4.5 to May
 * rather than returning an Invalid Date — so the "quarter" silently becomes
 * May–July, omitting April and double-counting July against Q3, under a filename
 * that still says Q2. `0` needs handling too: it is falsy, so a caller's `|| …`
 * fallback fires and it becomes the CURRENT quarter rather than Q1.
 */
export function clampQuarter(raw: number): number {
  // NaN needs its own branch: every comparison against it is false, so it would
  // otherwise fall through `Math.min` and come back out as NaN.
  if (Number.isNaN(raw)) return 1;
  const whole = Math.trunc(raw);
  // Infinity clamps to 4 rather than to 1 — it is out of range HIGH, and reading
  // it as "the first quarter" would be a different answer from `?q=9`.
  return whole < 1 ? 1 : Math.min(4, whole);
}

/** Quarter boundaries in UTC. Q1 = Jan–Mar. */
export function quarterRange(year: number, quarter: number): { from: Date; to: Date } {
  const startMonth = (quarter - 1) * 3;
  return {
    from: new Date(Date.UTC(year, startMonth, 1)),
    // Exclusive upper bound: the first instant of the next quarter. An inclusive
    // "last day" bound silently drops everything issued after 00:00 on it.
    to: new Date(Date.UTC(year, startMonth + 3, 1)),
  };
}

export type IcpLine = {
  countryCode: string;
  vatNumber: string;
  netCents: number;
  invoiceCount: number;
};

/**
 * Group reverse-charged invoices into one line per customer VAT number.
 *
 * The Belastingdienst wants one row per counterparty per period, not one per
 * invoice — and the amount is the NET, because the whole point of a reverse
 * charge is that no VAT was charged here.
 */
export function toIcpLines(
  invoices: { buyerSnapshot: unknown; netCents: number }[],
): IcpLine[] {
  const byNumber = new Map<string, IcpLine>();
  for (const inv of invoices) {
    const snap = (inv.buyerSnapshot ?? {}) as { vatNumber?: string | null; countryCode?: string };
    const vatNumber = snap.vatNumber?.trim();
    // An invoice with no VAT number on it cannot be reverse-charged, so its
    // presence here means something upstream is wrong. Skipping it silently would
    // hide that; it is surfaced by the count mismatch the page renders.
    if (!vatNumber) continue;
    const existing = byNumber.get(vatNumber);
    if (existing) {
      existing.netCents += inv.netCents;
      existing.invoiceCount += 1;
    } else {
      byNumber.set(vatNumber, {
        vatNumber,
        countryCode: snap.countryCode ?? vatNumber.slice(0, 2),
        netCents: inv.netCents,
        invoiceCount: 1,
      });
    }
  }
  return [...byNumber.values()].sort((a, b) => a.vatNumber.localeCompare(b.vatNumber));
}

/** RFC-4180-ish escaping: quote when the value could otherwise break a row. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Amounts as plain decimal EUR — what the filing form expects, not cents. */
export function toIcpCsv(lines: IcpLine[]): string {
  const rows = [
    ["country", "vat_number", "net_eur", "invoices"],
    ...lines.map((l) => [
      l.countryCode,
      l.vatNumber,
      (l.netCents / 100).toFixed(2),
      String(l.invoiceCount),
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
