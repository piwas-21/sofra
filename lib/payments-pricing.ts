// Payments pricing mode — flat fee vs per-transaction commission
// (workspace docs/plans/SOFRA-PAYMENTS-PRICING-MODE-PLAN.md, S1).
//
// The MECHANISM (Stripe `application_fee_amount` on the existing Connect direct
// charge) already shipped and is live — see the ADR-011 amendment referenced from
// `module-catalog.ts`. This module is only about the two ways a tenant can be
// billed for using it, and the pure arithmetic both billing and every future UI
// surface (S2 `/admin`, S3 signup, S4 partner dashboard) need to agree on.
//
// Pure by design — no DB, no network, no env — for the same reason
// `module-catalog.ts` and `payments-pending.ts` are: the numbers stay
// unit-testable and identical everywhere they are quoted. Money stays EUR/CHF
// **integer cents** throughout (CLAUDE.md §5.7); never a float.

import { MODULES } from "./module-catalog";

/**
 * `flat` — the tenant pays the `online-payments` module's list price and keeps
 * 100% of every online order (minus Stripe's own fee).
 *
 * `commission` — the module itself is free and Sofra takes a per-transaction cut
 * instead (`payments_commission_bps` in the registry, applied as Stripe's
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
 * Chosen, not arbitrary (plan §1): it puts the crossover against the
 * `online-payments` module's flat €19/mo at roughly **CHF 1,270 of monthly
 * online turnover** — about 30 orders at a CHF 40 average, which is close to "is
 * this channel real at all". Below that a switched tenant is paying MORE than
 * they would on `flat`; above it, less. And 150 bps is around **one-seventeenth**
 * of what a food-delivery aggregator takes (Uber Eats / Just Eat / Deliveroo run
 * 14–30%), which is the sentence that actually sells the switch to a restaurant
 * comparing the two.
 */
export const DEFAULT_COMMISSION_BPS = 150;

/**
 * The highest rate any tenant may be configured with — 1000 basis points, 10%.
 *
 * Re-stated here from `provision-tenant.sh` (deploy repo) and the backend, which
 * each enforce their own copy of this same number — this is not the one place it
 * lives, it is one of three that must agree, because each layer can be reached
 * without going through the other two (a hand-edited registry entry never
 * touches this file at all).
 *
 * WHY 1000, specifically: **measured 2026-09-04**, Stripe does NOT reject an
 * `application_fee_amount` larger than the charge it is attached to — it
 * silently CAPS it at 100% of the order instead. A requested fee of 5000 cents
 * on a 4000-cent charge produced an actual fee of 4000, with no error anywhere
 * in the response. So a fat-fingered or malicious rate above 100% would not
 * surface as a Stripe error for anyone to notice — it would just take the whole
 * order, silently, on every payment. The ceiling exists to make that
 * unreachable long before 100%, and it is a safety guard rather than a pricing
 * preference — which is exactly why it is re-declared at every layer that can
 * write a rate, instead of trusted to have been checked upstream.
 */
export const MAX_COMMISSION_BPS = 1000;

/**
 * Whether `value` is a rate this system will accept anywhere: a non-negative
 * integer no larger than {@link MAX_COMMISSION_BPS}.
 *
 * Basis points are always whole numbers here — `provision-tenant.sh` parses the
 * registry field with a `^[0-9]+$` regex, so a fractional bps could never survive
 * the round trip through the registry even if this check let it through earlier.
 */
export function isCommissionBps(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COMMISSION_BPS;
}

// The `online-payments` module's list price, read from the ONE catalog rather
// than hardcoded here — a price change in module-catalog.ts must not require a
// second edit in this file to stay correct. `.find` rather than a literal index
// because MODULES is declared as a plain array (module-catalog.ts's own
// PRICE_CENTS lookup exists for exactly this reason, but it is not exported —
// duplicating that lookup here would be the second copy DRY forbids, so this
// reads the public array instead).
//
// The non-null assertion is safe, not merely convenient: `module-catalog.test.ts`
// ("prices every module id exactly once") asserts MODULES carries every id in
// MODULE_IDS, `online-payments` included, so this can only fail if that test is
// also failing — at which point CI is already red for the right reason.
//
// Exported (S2b): the admin form needs the same price to quote a LIVE crossover
// preview as the admin types a rate, and `registry-commission-pr.ts` already reads
// this exact lookup for its own PR-body crossover — a third private copy would be
// the duplication DRY forbids, not less of it.
export const ONLINE_PAYMENTS_PRICE_CENTS = MODULES.find((m) => m.id === "online-payments")!.priceCents;

/**
 * Adjust a tenant's monthly module quote for its payments mode.
 *
 * `flat` changes nothing — the `online-payments` line (if the tenant has it) is
 * charged at its normal list price, same as every other module.
 *
 * `commission` zeroes that line: the module becomes €0/mo because Sofra is paid
 * per transaction instead (via `payments_commission_bps`, not this quote). A
 * tenant that does not have the module at all is unaffected either way — there
 * is nothing to subtract, and `commission` mode is meaningless without the
 * module actually being on.
 *
 * @param baseQuoteCents The tenant's normal `quoteModules(...).monthlyCents`,
 *   computed the usual way (this function does not re-price anything else).
 * @param hasOnlinePayments Whether the tenant's module selection includes
 *   `online-payments` — passed in rather than re-derived, because the caller
 *   already has the selection this quote was built from and a second parse of
 *   it here could disagree with the one that produced `baseQuoteCents`.
 */
export function paymentsModeQuote(
  baseQuoteCents: number,
  mode: PaymentsMode,
  hasOnlinePayments: boolean,
): number {
  if (mode !== "commission" || !hasOnlinePayments) return baseQuoteCents;
  return baseQuoteCents - ONLINE_PAYMENTS_PRICE_CENTS;
}

/**
 * The monthly online turnover, in minor units (cents) of the tenant's own
 * currency, at which `commission` costs exactly what `flat` costs — the number
 * the plan (§2) requires every switching surface to show, so an owner switching
 * a busy tenant to commission is doing it knowingly rather than by a policy that
 * quietly costs Sofra more than flat would have.
 *
 * Derivation: commission cost equals flat cost when
 * `turnover * (bps / 10000) = flatCents`, i.e. `turnover = flatCents / (bps /
 * 10000)` — rearranged below to keep the arithmetic in integers as long as
 * possible before the one unavoidable division.
 *
 * @param bps The tenant's rate. `0` returns `null`: at a 0% rate commission
 *   costs nothing no matter how much turns over, so there is no turnover figure
 *   at which the two modes cross — commission is free forever, which is a
 *   different statement from "the crossover is very high" and must not be
 *   rendered as a number.
 * @param flatCents The flat module price being compared against — the caller's
 *   `online-payments` price, not hardcoded here for the same reason
 *   {@link paymentsModeQuote} does not hardcode it.
 * @returns The crossover turnover rounded to the nearest cent (`Math.round`).
 *   This is a figure for a sentence a human reads ("free up to about
 *   CHF 1,267/mo"), not a billing amount computed FROM it, so a one-cent
 *   rounding choice has no downstream effect — nearest-cent was picked over a
 *   ceiling/floor because it needs no argument for which direction is "safe".
 */
export function crossoverCentsPerMonth(bps: number, flatCents: number): number | null {
  if (bps === 0) return null;
  return Math.round((flatCents * 10000) / bps);
}

/**
 * `bps` as the percentage string every UI surface quotes it with — `150` ->
 * `"1.50%"`. Two decimal places always: a rate can be as fine as 1 basis point
 * (0.01%), and rounding to one decimal would silently collapse it to `"0.0%"`.
 */
export function formatCommissionPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Narrow `TenantBilling.paymentsMode` (S2b) — a plain Prisma `String` column,
 * per this repo's handwritten-migration workflow (§5.2), not an enum — to
 * {@link PaymentsMode}. Anything other than the literal `"commission"` reads as
 * `"flat"`: the value every row defaulted to before this column existed, and
 * the safe reading of a value that should never occur outside a hand-edited
 * row. Every admin surface that reads the column goes through this rather than
 * an inline cast, so a typo in a future caller fails a type check instead of
 * silently widening to `string`.
 */
export function asPaymentsMode(value: string): PaymentsMode {
  return value === "commission" ? "commission" : "flat";
}
