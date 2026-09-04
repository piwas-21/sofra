// Module catalog + list pricing (sofra ADR-010, S11 v1).
//
// ONE source of truth for what a tenant can buy and what it costs, shared by the
// provisioning form (validating the registry `modules:` list), quoting, and later
// the public pricing page and the billing amount. Prices are EUR **integer cents**
// (CLAUDE.md §5.7) and are LIST prices: reseller wholesale and partner commission
// are applied on top of these by whoever bills (SOFRA-MODULE-CATALOG-AND-PRICING.md).
//
// Pure by design — no DB, no network, no env — so the numbers stay unit-testable
// and identical everywhere they are quoted.

import { isTenantLanguage } from "./tenant-options";

/** Registry `modules:` vocabulary. These exact strings live in tenants/registry.yml. */
export const MODULE_IDS = [
  "core",
  "kitchen-board",
  "cashier",
  "server",
  "reservations",
  "loyalty",
  "printing",
  "online-payments",
  "extra-languages",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export interface CatalogModule {
  id: ModuleId;
  /** EUR cents per venue per month, billed monthly. */
  priceCents: number;
  /** The RUMI surface this unlocks — kept next to the price so the two never drift. */
  surface: string;
  /**
   * Absent = sellable. `false` means the id is a VALID part of the registry vocabulary — a
   * tenant entry carrying it provisions, and the backend recognises it — but it must not be
   * offered for purchase yet, because the surface it unlocks is not finished. Selling a module
   * nothing enforces is charging for a product that does not vary.
   *
   * Both purchase surfaces filter on this: the public SignupConfigurator and the founder's
   * ProvisionPicker. Flip it (delete the line) in the slice that makes the module real.
   */
  sellable?: boolean;
}

/**
 * Core is mandatory (every tenant instance runs the menu + ordering + admin);
 * the rest are add-ons. Rationale for each number: the pricing sheet in
 * `docs/plans/SOFRA-MODULE-CATALOG-AND-PRICING.md` (workspace repo).
 */
export const MODULES: readonly CatalogModule[] = [
  { id: "core", priceCents: 1900, surface: "QR menu, online ordering, admin, en + 1 language" },
  { id: "kitchen-board", priceCents: 1200, surface: "/kitchen-staff live view" },
  { id: "cashier", priceCents: 1200, surface: "/cashier + Z-report" },
  { id: "server", priceCents: 1200, surface: "/server, table service, floor plan" },
  { id: "reservations", priceCents: 900, surface: "/reservations + admin management" },
  { id: "loyalty", priceCents: 900, surface: "fidelity points, customer groups, discounts" },
  { id: "printing", priceCents: 900, surface: "printer-app companion + printer feed" },
  // ADR-011 amendment (2026-09-04): a per-transaction commission mechanism now exists
  // (Stripe `application_fee_amount` on the existing Connect direct charge) but is not
  // priced here — it defaults to 0 bps for every tenant and is configured per tenant in
  // the deploy registry (`payments_commission_bps`), not in this catalog. Do NOT add a
  // commission-priced variant of this module until the ADR's refund gap is closed: Stripe
  // does not auto-refund the application fee, and RUMI does not refund Stripe-captured
  // payments today, so a live non-zero rate would keep the fee on every refund.
  {
    id: "online-payments",
    priceCents: 1900,
    surface: "card/TWINT at checkout, paid to the restaurant's own Stripe account",
  },
  { id: "extra-languages", priceCents: 500, surface: "beyond Core's en + 1, up to 10 locales" },
] as const;

export interface CatalogBundle {
  id: BundleId;
  /** Modules the bundle contains, `core` included. */
  modules: readonly ModuleId[];
  /** EUR cents per venue per month — below the sum of its parts. */
  priceCents: number;
}

export type BundleId = "counter" | "full-service";

export const BUNDLES: readonly CatalogBundle[] = [
  {
    id: "counter",
    modules: ["core", "kitchen-board", "cashier", "printing"],
    priceCents: 4500, // parts sum to 5200 (19 + 12 + 12 + 9) — saves €7
  },
  {
    id: "full-service",
    modules: [
      "core",
      "kitchen-board",
      "cashier",
      "printing",
      "server",
      "reservations",
      "loyalty",
    ],
    priceCents: 6900, // parts sum to 8200 — saves €13
  },
] as const;

// Keyed by ModuleId rather than a Map so a lookup is total: every catalog id has
// a price (asserted by a test), which keeps the pricing math free of `?? 0`
// fallbacks that could only ever hide a missing entry.
const PRICE_CENTS = Object.fromEntries(
  MODULES.map((m) => [m.id, m.priceCents]),
) as Record<ModuleId, number>;

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

/** The ids in `values` that are not in the catalog — empty means all valid. */
export function unknownModuleIds(values: readonly string[]): string[] {
  return values.filter((v) => !isModuleId(v));
}

export interface Quote {
  /** Cheapest packaging for the selection. */
  monthlyCents: number;
  /** The bundle used, or null when charging Core + add-ons individually. */
  bundle: BundleId | null;
  /** Modules charged on top of the bundle (or on top of Core). */
  extras: ModuleId[];
  /** What the same selection would cost with no bundle — the saving is the difference. */
  aLaCarteCents: number;
}

const sumCents = (ids: readonly ModuleId[]): number =>
  ids.reduce((total, id) => total + PRICE_CENTS[id], 0);

/**
 * Price a selection the way a customer should be charged: the cheapest packaging,
 * never the one that happens to be listed first. A bundle applies only when the
 * selection contains ALL of its modules, and it competes with plain à-la-carte —
 * a bundle that costs more than its subset must not be forced on anyone.
 *
 * `core` is implicit: a selection without it is priced as if it had it, because
 * every provisioned instance runs the core surface whatever the registry says.
 */
export function quoteModules(selection: readonly string[]): Quote {
  const ids = [...new Set(selection.filter(isModuleId))];
  if (!ids.includes("core")) ids.unshift("core");

  const aLaCarteCents = sumCents(ids);
  let best: Quote = {
    monthlyCents: aLaCarteCents,
    bundle: null,
    extras: ids.filter((id) => id !== "core"),
    aLaCarteCents,
  };

  for (const bundle of BUNDLES) {
    if (!bundle.modules.every((m) => ids.includes(m))) continue;
    const extras = ids.filter((id) => !bundle.modules.includes(id));
    const total = bundle.priceCents + sumCents(extras);
    if (total < best.monthlyCents) {
      best = { monthlyCents: total, bundle: bundle.id, extras, aLaCarteCents };
    }
  }
  return best;
}

/**
 * Languages billable as `extra-languages`: everything past English + one.
 *
 * A PRICING rule, so it lives with the catalog rather than with the language
 * vocabulary it reads — the add-on is per-tenant, not per-language, so one call
 * decides whether the module is on at all.
 */
export function extraLanguageCount(codes: readonly string[]): number {
  return Math.max(0, new Set(codes.filter(isTenantLanguage)).size - 2);
}
