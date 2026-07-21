// SofraPiwas's books are EUR (NL-registered company) — flipped from CHF on
// 2026-07-06 while the ledger was still empty. Per-tenant display currency
// is a separate product concern (tenant registry).
export function eur(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}
