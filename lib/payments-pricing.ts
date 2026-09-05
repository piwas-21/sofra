// Payments pricing mode — flat fee vs per-transaction commission. Prices live in
// workspace `docs/plans/SOFRA-MODULE-CATALOG-AND-PRICING.md` §3a; the decision
// behind the commission floor is in `docs/plans/BACKLOG.md`.
//
// The MECHANISM (Stripe `application_fee_amount` on the existing Connect direct
// charge) already shipped and is live — see the ADR-011 amendment referenced from
// `module-catalog.ts`. This module is only about the two ways a tenant can be
// billed for using it, and the pure arithmetic that `/admin`, the signup
// configurator and the partner dashboard must all agree on.
//
// Pure by design — no DB, no network, no env — for the same reason
// `module-catalog.ts` and `payments-pending.ts` are: the numbers stay
// unit-testable and identical everywhere they are quoted. Money stays EUR/CHF
// **integer cents** throughout (CLAUDE.md §5.7); never a float.

import { MODULES } from "./module-catalog";

/**
 * `flat` — the tenant pays the `online-payments` module's full list price and
 * keeps 100% of every online order (minus Stripe's own fee).
 *
 * `commission` — the module drops to a REDUCED FLOOR ({@link
 * COMMISSION_FLOOR_CENTS}, not zero) and Sofra takes a per-transaction cut on
 * top (`payments_commission_bps` in the registry, applied as Stripe's
 * `application_fee_amount`).
 *
 * `flat` is what every tenant is on today and stays the default (plan §1) — this
 * type exists so a mode is one of exactly two strings, never a third value that
 * both the quote and the registry would have to guess a meaning for.
 */
export type PaymentsMode = "flat" | "commission";

/**
 * The default per-transaction rate offered when a tenant switches to `commission`
 * — 150 basis points, 1.50%.
 *
 * Chosen, not arbitrary: it is around **one-seventeenth** of what a food-delivery
 * aggregator takes (Uber Eats / Just Eat / Deliveroo run 14–30%), which is the
 * sentence that actually sells the switch to a restaurant comparing the two. It
 * is deliberately UNCHANGED by the reduced floor below — the floor moved the
 * crossover, the rate did not have to.
 */
export const DEFAULT_COMMISSION_BPS = 150;

/**
 * The highest rate any tenant may be configured with — 1000 basis points, 10%.
 *
 * Re-stated here from `provision-tenant.sh` (deploy repo) and the backend, which
 * each enforce their own copy — this is not the one place it lives, it is one of
 * three that must agree, because each layer can be reached without the other two
 * (a hand-edited registry entry never touches this file at all).
 *
 * WHY 1000, specifically: **measured 2026-09-04**, Stripe does NOT reject an
 * `application_fee_amount` larger than the charge it is attached to — it
 * silently CAPS it at 100% of the order. A requested 5000 cents on a 4000-cent
 * charge produced an actual fee of 4000, with no error anywhere in the response.
 * So a fat-fingered or malicious rate above 100% would surface as no Stripe error
 * at all — it would just take the whole order, silently, on every payment. The
 * ceiling makes that unreachable long before 100%: a safety guard rather than a
 * pricing preference, which is why every layer that can write a rate re-declares
 * it instead of trusting an upstream check.
 */
export const MAX_COMMISSION_BPS = 1000;

/**
 * Whether `value` is a rate this system accepts anywhere: a non-negative integer
 * no larger than {@link MAX_COMMISSION_BPS}.
 *
 * Basis points are always whole here — `provision-tenant.sh` parses the registry
 * field with `^[0-9]+$`, so a fractional bps could never survive the round trip.
 */
export function isCommissionBps(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COMMISSION_BPS;
}

// The `online-payments` module's list price, read from the ONE catalog rather
// than hardcoded here — a price change in module-catalog.ts must not require a
// second edit in this file to stay correct. `.find` rather than a literal index
// because MODULES is a plain array (module-catalog.ts's own PRICE_CENTS lookup
// exists for exactly this reason but is not exported, and a second copy of it
// here is the duplication DRY forbids).
//
// The non-null assertion is safe, not merely convenient: `module-catalog.test.ts`
// ("prices every module id exactly once") asserts MODULES carries every id in
// MODULE_IDS, `online-payments` included, so this can only fail if that test is
// also failing — at which point CI is already red for the right reason.
//
// Exported because both prices a switching surface shows are read from here: the
// flat option's own price, and (through COMMISSION_MODE_SAVING_CENTS) what the
// commission option takes off it.
export const ONLINE_PAYMENTS_PRICE_CENTS = MODULES.find((m) => m.id === "online-payments")!.priceCents;

/**
 * What `online-payments` costs per month under `commission` — €9, **not €0**
 * (workspace `docs/plans/BACKLOG.md`, decided by the owner 2026-09-05).
 *
 * Offering `flat` and `commission` as a free peer choice collects
 * `min(flat, commission)` from every tenant, since each picks whichever is
 * cheaper at their own volume — worse than charging everybody the €19 flat
 * module. A floor keeps the choice and caps its downside at €9/tenant/mo instead
 * of €0. A FLOOR, not a discount: this is paid monthly PLUS the rate.
 */
export const COMMISSION_FLOOR_CENTS = 900;

/**
 * What choosing `commission` actually SAVES on the module — €19 − €9 = €10/mo —
 * and therefore the only figure a crossover may be computed from.
 *
 * THE TRAP THE FLOOR INTRODUCED: before it, the saving WAS the full list price,
 * so passing `ONLINE_PAYMENTS_PRICE_CENTS` was right by accident. With a floor
 * that overstates the break-even by 1.9x (€1,267 against €667) on the exact page
 * where someone commits money. Hence derived from both prices rather than
 * written down, and {@link crossoverCentsPerMonth} DEFAULTS to it — a UI caller
 * cannot pass the wrong basis because it passes none at all.
 */
export const COMMISSION_MODE_SAVING_CENTS = ONLINE_PAYMENTS_PRICE_CENTS - COMMISSION_FLOOR_CENTS;

/**
 * Adjust a tenant's monthly module quote for its payments mode.
 *
 * `flat` changes nothing — the `online-payments` line (if the tenant has it) is
 * charged at its normal list price, same as every other module.
 *
 * `commission` reduces that line to {@link COMMISSION_FLOOR_CENTS} — it does NOT
 * remove it — because Sofra is additionally paid per transaction (via
 * `payments_commission_bps`, not this quote). A tenant without the module is
 * unaffected either way: there is nothing to reduce, and `commission` mode is
 * meaningless without the module being on.
 *
 * @param baseQuoteCents The tenant's normal `quoteModules(...).monthlyCents`,
 *   computed the usual way (this function does not re-price anything else).
 * @param hasOnlinePayments Whether the selection includes `online-payments` —
 *   passed in rather than re-derived, because a second parse here could disagree
 *   with the one that produced `baseQuoteCents`.
 */
export function paymentsModeQuote(
  baseQuoteCents: number,
  mode: PaymentsMode,
  hasOnlinePayments: boolean,
): number {
  if (mode !== "commission" || !hasOnlinePayments) return baseQuoteCents;
  return baseQuoteCents - COMMISSION_MODE_SAVING_CENTS;
}

/**
 * The monthly online turnover, in minor units (cents) of the tenant's own
 * currency, at which `commission` costs exactly what `flat` costs — the sentence
 * EVERY switching surface must show, so nobody moves a busy tenant onto a mode
 * that quietly costs them (or Sofra) more than the one they left.
 *
 * Derivation: the modes cost the same when the commission equals what the module
 * was REDUCED BY — `turnover * (bps / 10000) = savingCents`, so `turnover =
 * savingCents * 10000 / bps`, rearranged below to stay in integers until the one
 * unavoidable division. The SAVING, never the full list price: a `commission`
 * tenant still pays {@link COMMISSION_FLOOR_CENTS}, so only the €10 difference
 * has to be earned back.
 *
 * @param bps The tenant's rate. `0` returns `null`: at a 0% rate commission
 *   costs nothing no matter how much turns over, so there is no turnover figure
 *   at which the two modes cross — "free forever" is a different statement from
 *   "the crossover is very high" and must not be rendered as a number.
 * @param savingCents What choosing `commission` takes off the monthly bill.
 *   Defaults to {@link COMMISSION_MODE_SAVING_CENTS} — what every UI caller
 *   wants and therefore what none of them passes; the parameter survives only so
 *   the arithmetic stays testable against worked examples that owe nothing to
 *   the current catalog.
 * @returns The turnover, rounded to the nearest cent. A figure for a sentence a
 *   human reads, never a billing amount computed FROM it, so the rounding
 *   direction needs no argument for which way is "safe".
 */
export function crossoverCentsPerMonth(
  bps: number,
  savingCents: number = COMMISSION_MODE_SAVING_CENTS,
): number | null {
  if (bps === 0) return null;
  return Math.round((savingCents * 10000) / bps);
}

/**
 * `bps` as the percentage string every UI surface quotes it with — `150` ->
 * `"1.50%"`. Always two decimals: a rate can be as fine as 1 basis point
 * (0.01%), which one decimal would silently collapse to `"0.0%"`.
 */
export function formatCommissionPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Narrow `TenantBilling.paymentsMode` — a plain Prisma `String` column, per this
 * repo's handwritten-migration workflow (§5.2), not an enum — to {@link
 * PaymentsMode}. Anything but the literal `"commission"` reads as `"flat"`: the
 * value every row defaulted to before this column existed, and the safe reading
 * of a value that should never occur outside a hand-edited row. Every admin
 * surface goes through this rather than an inline cast, so a typo in a future
 * caller fails a type check.
 */
export function asPaymentsMode(value: string): PaymentsMode {
  return value === "commission" ? "commission" : "flat";
}
