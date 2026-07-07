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

**Status note (2026-07-07) — v1 IMPLEMENTED (ROADMAP S9):** profile approved
2026-07-06; recurring shipped in the control plane. Shape: admin creates a
`TenantBilling` (Mollie customer, keyed by registry slug, auto-linked to the
CRM `Client` via `tenantSlug`) + a plan (`BillingSubscription`, EUR cents) +
a hosted-checkout **first payment**; the tenant pays it once, which creates
the mandate; the webhook (`/api/webhooks/mollie`, fetch-and-verify — Mollie
webhooks are unsigned) then auto-creates the Mollie subscription starting one
interval out and mirrors every payment into `BillingPayment`. Founder gets
craft-email notifications on paid/failed. Admin UI under `/admin/billing`.
Env: `MOLLIE_API_KEY` (test_/live_ selects mode; unset = billing disabled,
site unaffected). **Deferred to v2:** numbered invoices/PDFs (the domainio
invoice pattern), dunning/retry flows, tenant-facing receipts, CHF pricing,
partner-commission automation (ADR-009).
