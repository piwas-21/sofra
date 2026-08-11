# ADR-013 — Billing identity, VAT treatment and invoicing

**Status:** accepted 2026-08-11. Implements workspace
`docs/plans/SOFRA-BILLING-IDENTITY-PLAN.md` (B1–B7, B9). **Amends ADR-005**,
which deferred "numbered invoices/PDFs" to v2.

## Context

The control plane billed real money on a live Mollie key from 2026-07-07 while
storing, for everyone it charged, **a name and an email address**. That is not
enough to issue an invoice, and nowhere near enough to decide what VAT applies:
the same two fields describe a Swiss tenant (outside the scope of EU VAT) and a
French partner (reverse-charged), which are different sales in law. No invoice
was issued to anyone.

Surfaced by onboarding the first partner who is a foreign registered business.

## Decisions

1. **Legal identity is a property of the PARTY, not of the subscription.**
   `BillingIdentity` is its own table, referenced by `TenantBilling`. Onboarding
   reuses an existing ACTIVE partner by design, so a reseller with three
   restaurants is one legal entity with three subscriptions; legal fields on
   `TenantBilling` would be copied three times and drift, and the first
   divergence would appear as two invoices to one company at different
   addresses. **Every reader resolves through `resolveIdentityForPlan`**, never
   through the plan's own link — the two disagree for any plan whose link is
   still null, and a reader that disagrees with the writer is how a form comes to
   overwrite a record it never displayed.

2. **A VAT number's status is tri-valued, and `UNAVAILABLE` is first-class.**
   VIES serializes its own outages as `valid:false` (the French node throttled 5
   of 8 calls during the research), so a two-state model turns a busy member
   state into a rejected customer and silently retracts a reverse charge proved
   last quarter. An outage never overwrites a proven `VALID`; a real
   member-state verdict does. A status belongs to the **number it was proven
   for**, so changing the number resets it.

3. **The tax treatment is decided by one pure function and STORED on the
   invoice.** Where the law is a judgement call — an EU buyer without a valid
   number, an EU consumer under OSS — it returns `NEEDS_REVIEW` with no rate and
   nothing is issued. A blocked invoice is cheaper than a wrong one, which is
   only discovered at audit. Storing the treatment is also what makes the ICP
   export a query rather than a reconstruction months later.

4. **Invoices are immutable and gaplessly numbered.** Both parties are frozen as
   JSON snapshots at issue time (named fields only — a spread would copy the
   whole row onto a table with no delete path). Numbers are allocated under a
   **transaction-scoped advisory lock taken before the read**, with
   `@@unique([series, year, seq])` as the backstop; removing the lock makes 21 of
   25 concurrent issuances fail, which is how we know it is load-bearing. A
   correction is a credit note (not built).

5. **The company's own registration details come from env, and their absence
   blocks every invoice.** A placeholder KVK number on a real invoice is worse
   than no invoice, because it looks finished. The same values render the
   public imprint, so the two can never disagree.

6. **Issuing must never throw into the Mollie webhook.** A failure to invoice
   must not turn a successful payment into a retry loop. Refusals are recorded
   and surfaced on `/admin/invoices`, with an admin action to issue them once the
   cause is fixed — without which a blocked charge could never become an invoice,
   since the webhook answers 200 and is never redelivered.

7. **The invoice is HTML with a print stylesheet, not a PDF.** This repo carries
   eleven dependencies and hand-rolls its Mollie and Resend clients rather than
   take an SDK. The legal requirement is the content; the structured model makes
   PDF or Peppol a renderer over the same rows rather than a migration.

8. **The charged amount is VAT-INCLUSIVE.** Mollie is created for the catalogue
   price and nothing is added, so the money that arrived is the total. Reading it
   as net would declare VAT that was never collected, out of margin. Making
   prices explicitly ex-VAT is a change to what is CHARGED, not to this
   arithmetic.

## Consequences

- Two new tables (`BillingIdentity`, `Invoice`/`InvoiceLine`), all additive.
- A first payment now requires a complete identity. Existing ACTIVE
  subscriptions are untouched — the gate sits after the `alreadyActive` check.
- `SOFRA_LEGAL_*` and `SOFRA_VAT_NUMBER` become operational prerequisites for
  invoicing. Until the owner supplies them, charges settle and appear on the
  not-invoiced list.
- An issued invoice cannot be erased, so a DSR erasure request has a documented
  exception; the snapshot's field list is deliberately explicit and minimal.

## Not decided here (owner)

Commercial terms text, the accountant's confirmation of the §4 matrix and of
decision 8, and whether catalogue prices become ex-VAT. Credit notes, dunning,
OSS rates and VAT-territory exclusions are out of scope and documented as such.
