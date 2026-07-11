/**
 * Single source of truth for the /changelog page: the visible entries and the
 * page's JSON-LD both iterate these keys against the `changelog.entries.*`
 * messages. Adding an entry = one line here + title/body keys in all six
 * message files (newest first; dates are ISO, rendered per locale).
 */
export const CHANGELOG_ENTRIES = [
  { key: "currency", date: "2026-07-10" },
  { key: "hardening", date: "2026-07-09" },
  { key: "billing", date: "2026-07-07" },
  { key: "languages", date: "2026-07-06" },
  { key: "launch", date: "2026-07-05" },
] as const;
