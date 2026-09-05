// SofraPiwas's books are EUR (NL-registered company) — flipped from CHF on
// 2026-07-06 while the ledger was still empty. Per-tenant display currency
// is a separate product concern (tenant registry).
export function eur(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/**
 * Minor units in an ARBITRARY currency — for money that is NOT Sofra's EUR books.
 *
 * A Stripe application fee is denominated in the CHARGE's currency (`chf` for a
 * Swiss tenant), so rendering one with `eur()` prints "€ 0,60" for a CHF 0.60
 * fee: a wrong symbol over a wrong number, and nothing goes red. `eur()` stays
 * the formatter for the ledger, subscriptions and invoices.
 *
 * STATED LIMITATION: `/100` assumes a two-decimal currency. Every market Sofra
 * sells to (CHF, EUR) is two-decimal; a zero-decimal one (JPY) would be wrong by
 * 100x. That is a smaller lie than an exponent table for a currency the product
 * cannot reach — and the reason lib/commission-earnings.ts returns minor units
 * plus a code, so this stays a display-layer concern.
 */
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(minor / 100);
}

export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/**
 * Bytes as a short human string: `18 MiB`, `1.4 GiB`, `0 B`.
 *
 * BINARY units (1024), not decimal, because the numbers on /admin/backups come
 * from `restic` and `du`, which both report binary — a page that silently
 * restated 18 MiB as 18.9 MB would not match anything an operator sees on the
 * box, and the whole value of the page is that it agrees with the box.
 *
 * One decimal place from MiB upward and none below: `1.4 GiB` is a size, `1434.7
 * KiB` is a number to decode. Locale-independent on purpose — these are
 * technical units rendered beside a snapshot id, not prose.
 */
export function humanBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // `unit >= 2` is MiB and up. Below that the fraction is noise: a dump is never
  // interestingly 512.3 KiB rather than 512 KiB.
  return `${unit >= 2 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
