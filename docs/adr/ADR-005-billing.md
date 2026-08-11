# ADR-005 — Billing: Mollie (Sofra → tenant subscriptions)

**Status:** accepted 2026-07-04; **amended 2026-07-05 — scope narrowed to
Job A (Sofra billing its tenants). Tenant→end-customer payments are a separate
concern: see ADR-011.** **Amended 2026-08-11 — the deferred invoicing is BUILT:
see ADR-013.**

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
partner-commission automation (ADR-009), founder alert when a mandate never
validates and webhook retries exhaust (~26h).

**Status note (2026-07-07, later) — LIVE mode:** interactive checkout E2E
executed on staging (throwaway plan, iDEAL test checkout, full teardown);
it caught a mandate race — the paid first-payment webhook can beat the
mandate flipping valid, and the then-silent skip + 200 stranded the plan
PENDING forever (Mollie only redelivers on non-2xx, and `paid` is its last
transition). Fixed in PR #13: `MandateNotReadyError` → webhook 503 →
Mollie retries. Box key flipped to `live_` the same day; billing is
operational for real tenants.

**Status note (2026-08-11) — the "Deferred to v2" list is partly closed.**
**Numbered invoices are built** (ADR-013): immutable, gaplessly numbered under a
transaction-scoped advisory lock, with both parties frozen as snapshots and the
VAT treatment decided by `lib/tax-treatment.ts` and stored on the row. Rendered
as HTML with a print stylesheet rather than as a PDF — the legal requirement is
the content, and the structured model makes a PDF a renderer later rather than a
migration.

Two things that list assumed are now known to be wrong or incomplete:
`domainio`'s invoice pattern was **not** ported (it predates this VAT model, and
the reverse-charge/outside-scope treatments have no equivalent there), and the
tenant-facing surface was never merely "receipts" — a tenant needs the invoice
itself, so it is served at `/invoices/[id]` behind the payer's own session.

**Still deferred:** credit notes (the correction path for a wrong invoice),
dunning/retry flows, CHF pricing, ADR-009 commission automation, and the
mandate-never-validates founder alert.
