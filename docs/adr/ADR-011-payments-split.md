# ADR-011 — Payments split: Mollie for Sofra billing, Stripe Connect for tenant payments

**Status:** accepted 2026-07-05 (owner decision); **amended 2026-09-04** — Job B
gains the application-fee mechanism, still defaulting to 0 for every tenant. See
§Amendment.

Two distinct payment jobs, two providers:

## Job A — Sofra bills its tenants (subscriptions, CHF/EUR)

**Mollie** (amends ADR-005). Profile for sofrapiwas.com submitted 2026-07-05,
awaiting approval + API keys. Port domainio's webhook-verification + invoice
patterns; **recurring (customers + mandates + subscriptions) is net-new** —
domainio has no subscription code. Module/bundle prices (ADR-010) and
path-3 domain fees (ADR-002) ride the same subscription/invoice.

## Job B — Tenants charge their end customers (online orders)

**Stripe Connect**, when the online-payments module is scheduled: each
restaurant becomes a connected account (Express onboarding), Sofra takes an
application fee per transaction. Chosen over Mollie-for-Platforms for platform
maturity, Swiss-merchant + TWINT coverage, and worldwide headroom as markets
expand beyond CH/NL/FR.

## Amendment (2026-09-04) — the commission mechanism exists now; the rate is still zero

Job B said "Sofra takes an application fee per transaction." It never shipped one:
v1 is Direct charges with `application_fee_amount` deliberately unset
(`IStripeGateway.BuildRequestOptions` docstring, backend — *"Sofra takes no
commission and the money never touches its balance"*). This amendment adds the
mechanism. **It does not turn it on for anyone.**

**The mechanism.** `application_fee_amount` on the existing Connect **Standard
direct charge** — charge type, connected account, onboarding and settlement are
all unchanged. Money still never passes through Sofra's balance; Stripe transfers
the fee to the platform after the charge settles on the connected account.

**Configuration.** Backend setting `Stripe:Commission:Bps` (basis points),
overridden per tenant via the deploy registry key `payments_commission_bps`.
**Default 0.** Putting a tenant on a rate is a registry edit, not a deploy.

**Measured 2026-09-04**, platform `acct_1TpwTNCAHTt6eZ8i` (NL) against a
throwaway CH connected account, Stripe test mode:

- An NL platform **can** collect an application fee from a CH connected account —
  a real `ApplicationFee` object was produced. Stripe's docs only say fees work in
  "most countries with a few exceptions based on the country pair"; NL→CH is not
  one of the exceptions.
- The fee arrives **in CHF**, so the EUR-booked NL platform accrues a CHF
  balance. FX applies on conversion.
- **An oversized fee is CAPPED, not rejected.** A requested fee of 5000 on a
  4000 charge produced an `ApplicationFee` of 4000 with no error — Stripe took
  the whole order rather than refuse the request. Hence the backend enforces its
  own ceiling of **1000 bps (10%)**; nothing upstream will stop a misconfigured
  value above that.
- `POST /v1/checkout/sessions` validates the fee **not at all** — it accepted a
  fee larger than the order, and accepted a session on an account with
  `charges_enabled: false`. Only confirming a PaymentIntent discriminates.

**Two consequences, recorded as open — not solved by this change:**

1. **Refunds.** Stripe does not auto-refund the application fee when a charge is
   refunded; the platform must pass `refund_application_fee=true` or the
   connected account eats the fee. RUMI today deliberately refuses to refund
   Stripe-captured payments (`TenderCustody` — the platform key has no refunds
   write), so the restaurant refunds from its own Stripe dashboard and nothing
   returns the fee. **A non-zero rate must not be switched on for any tenant
   until this is closed.** The intended fix is a platform-level Connect webhook
   (`connect: true`) on `charge.refunded`, which IS permitted — unlike
   registering a webhook on a connected account.
2. **No commission reporting surface.** Fees accrue in the platform's own
   Stripe balance; nothing in the control plane reports them per tenant.
   `CommissionEntry` is the **partner** ledger (ADR-009) and must not be
   overloaded for this — different entity, different money, different source
   of truth.

**What this amendment does not touch:** no tenant's rate, the module's price, or
its marketing copy. `online-payments`' "no commission" promise — the payments
FAQ answer (`faq.items.payments.a`) and the competitor-comparison row
(`compare.table.rows.payments.sofra`), twice per locale across `en de nl fr tr
ar` (twelve strings, verified by grep 2026-09-04) — is still **true**, because
every tenant is at 0. That copy is exactly what must change, in all twelve
places, the day a tenant is first put on a non-zero rate — and not before.

## Why split rather than one provider

- Sofra-the-merchant is EU/NL-anchored — Mollie's home turf, cheapest
  iDEAL/SEPA rates, profile already in progress.
- The restaurants are CH-first — TWINT is table stakes there, and Stripe's
  connected-account tooling (onboarding, KYC, payouts, application fees) is
  the most mature option and scales to "maybe worldwide".
- The two jobs share no code path; splitting costs no integration duplication.

## Verify at implementation (facts not re-confirmed on 2026-07-05 —
research was cut short; do NOT publish these as claims before checking)

- Mollie: Swiss **sub-merchant**/platform coverage; current TWINT status.
- Stripe: TWINT availability matrix (merchant countries), Connect Express in CH.
- Current fee tables for both (EU cards, TWINT, iDEAL) — feeds ADR-010 pricing.
