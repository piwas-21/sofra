-- Partner onboarding + self-serve billing (SOFRA-PARTNER-PLAN, reseller flow).
-- A PENDING plan can now exist before any Mollie customer: an admin defines the
-- plan when onboarding a referred partner, and the Mollie customer is created
-- only when the partner starts the first payment.

-- mollieCustomerId nullable until the first payment is started. The unique index
-- is unaffected (Postgres treats NULLs as distinct).
ALTER TABLE "TenantBilling" ALTER COLUMN "mollieCustomerId" DROP NOT NULL;

-- Display-only tenant go-live date, shown on the partner welcome panel.
ALTER TABLE "TenantBilling" ADD COLUMN "liveSince" TIMESTAMP(3);
