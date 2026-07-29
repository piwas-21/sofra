// Is this tenant slug actually usable? (SOFRA-ONBOARDING-PLAN O1, trap 3)
//
// The slug is the single most expensive field in the funnel to get wrong: it
// becomes the subdomain, the database, the DB role AND the compose project, and
// none of those can be renamed afterwards. Changing it means a full re-provision.
// So it is worth answering three separate questions before anyone commits to one:
//
//   1. does it match the grammar? (already enforced by zod + the HTML pattern)
//   2. is it RESERVED — a hostname we or our infrastructure already answer on?
//   3. is it TAKEN — already a tenant in the registry?
//
// (2) was the real gap. (3) was already refused by `openProvisioningPr`, but only
// after a GitHub API round-trip at the very end of the founder's typing; checking
// it against the locally-read registry surfaces the same answer earlier and for
// free. That check stays as the backstop — it sees a slug this one cannot, since
// a still-open proposal isn't on the base branch yet.
//
// Pure — no DB, no network, no env — so it is unit-testable and usable from both
// the server and the browser.

/**
 * Slugs that must never become a tenant, because `<slug>.sofrapiwas.com` would
 * collide with, or impersonate, something that already exists.
 *
 * Grouped by why, because an unexplained deny-list rots — someone eventually
 * deletes an entry they cannot account for. Kept deliberately tight: this blocks
 * a paying customer's chosen name, so every entry needs a reason.
 *
 * NOTE `demo` is absent on purpose. It is a real, live tenant
 * (demo.sofrapiwas.com), not a reserved word — reserving it would report the
 * showcase as unusable rather than as taken.
 */
export const RESERVED_SLUGS: readonly string[] = [
  // The marketing site and the control plane itself.
  "www",
  "sofra",
  "sofrapiwas",
  "admin",
  "api",
  "app",
  "dashboard",
  "login",
  "auth",
  "account",
  "billing",
  "partner",
  "partners",
  // Environment names — a tenant here would be indistinguishable from infra.
  "staging",
  "dev",
  "test",
  "preview",
  "local",
  "localhost",
  // Mail and DNS: these names carry SPF/DKIM/DMARC and MX meaning for the zone.
  "mail",
  "smtp",
  "imap",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "dkim",
  "dmarc",
  // Ops surfaces on the boxes.
  "status",
  "monitor",
  "grafana",
  "dozzle",
  "registry",
  "box",
  "internal",
  "root",
  // Content surfaces we may want on the apex zone later. Cheap to reserve now,
  // impossible to reclaim once a tenant owns one.
  "cdn",
  "static",
  "assets",
  "docs",
  "help",
  "support",
  "blog",
  "shop",
  "pay",
];

const RESERVED = new Set(RESERVED_SLUGS);

/** The registry grammar, matching `provisionSchema` and the forms' HTML pattern. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;

export type SlugStatus = "available" | "invalid" | "reserved" | "taken";

/**
 * Classify a desired slug.
 *
 * Order matters: grammar first (a malformed slug is not meaningfully "taken"),
 * then `taken`, then `reserved`. Taken outranks reserved because it is the more
 * concrete, more actionable answer — if a name is somehow both, "another
 * restaurant already has it" tells the founder more than "we hold that word".
 *
 * The input is trimmed but deliberately NOT lower-cased before the grammar test.
 * The pattern forbids uppercase, and `provisionSchema` plus the forms' HTML
 * pattern both reject it outright — so normalising here would make this function
 * call `Chez-Amara` available for a slug the authoritative validators refuse, and
 * the founder would meet the rejection one screen later. Only the registry side
 * of the `taken` comparison is normalised, because that file is hand-edited YAML.
 */
export function checkSlug(
  raw: string | null | undefined,
  takenSlugs: Iterable<string> = [],
): SlugStatus {
  const slug = (raw ?? "").trim();
  if (!SLUG_PATTERN.test(slug)) return "invalid";
  // Past the grammar the slug is guaranteed lowercase, so the comparisons below
  // only have to normalise the registry's side.
  for (const t of takenSlugs) {
    if (t.trim().toLowerCase() === slug) return "taken";
  }
  if (RESERVED.has(slug)) return "reserved";
  return "available";
}

/** True when a slug can be provisioned as-is. */
export function isSlugUsable(
  raw: string | null | undefined,
  takenSlugs: Iterable<string> = [],
): boolean {
  return checkSlug(raw, takenSlugs) === "available";
}
