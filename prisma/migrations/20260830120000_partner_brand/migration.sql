-- The public face of a partner (workspace docs/plans/SOFRA-PARTNER-PLAN.md §11).
--
-- A partner asked to appear in the footer of the restaurant sites they resell.
-- The control plane already held company data about them — but ONLY as
-- `BillingIdentity`, which is the private legal and tax record: the registered
-- name, the invoice address, a registration number, a VAT number. For a sole
-- trader (the shape of the first reseller) that name is a NATURAL PERSON and
-- that address is where they live. Reusing it would have published someone's
-- home address on a public website in order to save them typing.
--
-- So this is a SECOND, PUBLIC record, entered by hand, never joined to the
-- first. Only what is typed here can ever be shown. The two tables stay apart so
-- that publishing a brand cannot publish an invoice address.
--
-- `publishToTenants` DEFAULT FALSE, and nothing reads it yet: the publishing
-- half is gated on an owner decision about what a diner may be told about a
-- third party. The column records the partner's intent rather than leaving it to
-- be inferred later, and the app renders the switch disabled until there is
-- something to switch on.
--
-- ADDITIVE AND SAFE ON A DB WITH LIVE ROWS: one new table, no column added to,
-- renamed on, or dropped from any existing one, no backfill, no data rewrite.
-- Nothing reads it until the surfaces in this PR do, so applying it before
-- rolling the app is a no-op for every running query plan.
--
-- PRIMARY KEY is `partnerId` itself, not a surrogate id: a partner has exactly
-- one public brand, and the identity of the row IS the partner. That is also what
-- makes the write an `upsert` on a key the server takes from the session, so no
-- request can name the row it edits.

CREATE TABLE "PartnerBrand" (
    "partnerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tagline" TEXT,
    "websiteUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "countryCode" TEXT,
    "publishToTenants" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerBrand_pkey" PRIMARY KEY ("partnerId")
);

-- CASCADE: a brand is meaningless without the partner it belongs to, and a
-- departed partner's public details must not outlive their account.
ALTER TABLE "PartnerBrand" ADD CONSTRAINT "PartnerBrand_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
