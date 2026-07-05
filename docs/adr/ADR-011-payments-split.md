# ADR-011 — Payments split: Mollie for Sofra billing, Stripe Connect for tenant payments

**Status:** accepted 2026-07-05 (owner decision)

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
