# ADR-005 — Billing: Mollie (Sofra → tenant subscriptions)

**Status:** accepted 2026-07-04; **amended 2026-07-05 — scope narrowed to
Job A (Sofra billing its tenants). Tenant→end-customer payments are a separate
concern: see ADR-011.**

Mollie (EU-native, proven in domainio) for Sofra's own subscription billing in
CHF/EUR. Port webhook/invoice patterns from domainio `lib/services/mollie-*.ts`,
`invoice.service.ts` and its `docs/architecture/07-pricing-and-billing.md`.

**Status note (2026-07-05):** Mollie profile for sofrapiwas.com submitted,
awaiting approval + API keys. **Recurring billing (customers + mandates +
subscriptions) is net-new code** — domainio only implements one-off payments and
balance top-ups, so only the webhook-verification and invoice patterns port.
