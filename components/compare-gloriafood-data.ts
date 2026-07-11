/**
 * Single source of truth for /compare/gloriafood: table rows, Q&A blocks and
 * the sources list all iterate these keys against the `compare.*` messages.
 *
 * Every factual claim about GloriaFood on that page was verified against the
 * SOURCES below on 2026-07-10 (AEO plan §2 requires re-verification before
 * changing any of them — their pricing/features can move).
 */
export const COMPARE_ROW_KEYS = [
  "pricing",
  "ordering",
  "reservations",
  "loyalty",
  "printing",
  "languages",
  "hosting",
  "setup",
  "payments",
] as const;

export const COMPARE_QA_KEYS = ["free", "cost", "pick"] as const;

export const FIT_GF_KEYS = ["widget", "self", "freeTier"] as const;
export const FIT_SOFRA_KEYS = ["one", "languages", "hands", "domain"] as const;

/** Labels live in `compare.sources.items.*`; URLs are not translated. */
export const COMPARE_SOURCES = [
  { key: "pricing", url: "https://www.gloriafood.com/pricing" },
  { key: "app", url: "https://www.gloriafood.com/restaurant-order-taking-app" },
  { key: "translation", url: "https://www.gloriafood.com/gloriafood-translation" },
] as const;

/** Shown as the visible "last checked" date and in the page JSON-LD. */
export const COMPARE_LAST_CHECKED = "2026-07-10";
