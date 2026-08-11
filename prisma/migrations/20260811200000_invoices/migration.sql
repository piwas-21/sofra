-- Invoices (workspace docs/plans/SOFRA-BILLING-IDENTITY-PLAN.md, B4).
--
-- ADR-005 deferred "numbered invoices/PDFs" to v2 in July 2026, and the control
-- plane has been taking real money on a live Mollie key ever since with no document
-- behind it. This is that v2 for the numbering and the record; the rendering is a
-- separate concern layered on top.
--
-- WHY THE SNAPSHOTS ARE JSON COLUMNS rather than joins:
-- an invoice records what was true on the day it was issued. Rendering it from a
-- live join means the customer editing their address silently rewrites every past
-- invoice, and Sofra moving office rewrites all of them at once. The relation to
-- BillingIdentity is kept ALONGSIDE the snapshot, because the ICP export needs to
-- group by party without parsing JSON — but the document renders from the snapshot.
--
-- WHY THE FK IS RESTRICT, uniquely in this schema:
-- everywhere else (TenantBilling.payerUserId, .clientId, .billingIdentityId) uses
-- ON DELETE SET NULL, so deleting a user never cascades into billing history. Here
-- the opposite is required: an identity with invoices against it must not be
-- deletable at all, because a null would leave a document nobody is addressed to.
--
-- WHY (series, year, seq) IS UNIQUE and `number` is unique too:
-- the composite is what the allocator locks on; `number` is what a human quotes.
-- Both are enforced so a bug in the formatter cannot produce two rows that agree
-- on the tuple and disagree on the printed string, or vice versa.
--
-- GAPLESSNESS IS NOT ENFORCED HERE, and cannot be. It is a property of how the
-- sequence is allocated — a transaction-scoped advisory lock taken BEFORE the read
-- of the current maximum (lib/invoicing.ts). This is the same shape as the backend's
-- order-number race (restaurant-app-backend #336): a read-then-increment with no
-- lock let two concurrent writers collide. The failure mode here is worse than a
-- 500 — a duplicate or skipped invoice number is a books problem — so the unique
-- constraint below is the backstop that turns a lost race into a refused write
-- rather than a silent duplicate.
--
-- Additive: two new tables. No existing row is read or modified.

-- CreateTable
CREATE TABLE "Invoice" (
    "id"                TEXT NOT NULL,
    "number"            TEXT NOT NULL,
    "series"            TEXT NOT NULL DEFAULT 'SP',
    "year"              INTEGER NOT NULL,
    "seq"               INTEGER NOT NULL,
    "issuedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sellerSnapshot"    JSONB NOT NULL,
    "buyerSnapshot"     JSONB NOT NULL,
    "billingIdentityId" TEXT NOT NULL,
    "tenantSlug"        TEXT NOT NULL,
    "currency"          TEXT NOT NULL DEFAULT 'EUR',
    "netCents"          INTEGER NOT NULL,
    "vatCents"          INTEGER NOT NULL,
    "grossCents"        INTEGER NOT NULL,
    "vatRateBps"        INTEGER NOT NULL,
    "taxTreatment"      TEXT NOT NULL,
    "taxNote"           TEXT,
    "molliePaymentId"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceLine" (
    "id"          TEXT NOT NULL,
    "invoiceId"   TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity"    INTEGER NOT NULL DEFAULT 1,
    "unitCents"   INTEGER NOT NULL,
    "netCents"    INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd"   TIMESTAMP(3),

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- The idempotency anchor. Mollie redelivers webhooks, so "have I already invoiced
-- this charge?" has to be answerable from our own rows and not from hoping the
-- delivery arrives once. Multiple NULLs are allowed, which is what lets a
-- hand-issued invoice exist with no payment behind it.
CREATE UNIQUE INDEX "Invoice_molliePaymentId_key" ON "Invoice"("molliePaymentId");

-- The backstop for the allocator: a lost race becomes a refused write, never a
-- silent duplicate number.
CREATE UNIQUE INDEX "Invoice_series_year_seq_key" ON "Invoice"("series", "year", "seq");

CREATE INDEX "Invoice_billingIdentityId_issuedAt_idx" ON "Invoice"("billingIdentityId", "issuedAt");
CREATE INDEX "Invoice_tenantSlug_issuedAt_idx" ON "Invoice"("tenantSlug", "issuedAt");
CREATE INDEX "Invoice_taxTreatment_issuedAt_idx" ON "Invoice"("taxTreatment", "issuedAt");
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_billingIdentityId_fkey"
  FOREIGN KEY ("billingIdentityId") REFERENCES "BillingIdentity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
