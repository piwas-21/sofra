-- A partner's own base domain, and the proof they hold it
-- (workspace docs/plans/SOFRA-PARTNER-FLEXIBILITY-PLAN.md D1/D1b).
--
-- The first reseller (Solution Eva) wants his clients under HIS zone —
-- `obresse.solutioneva.com`. The infrastructure half already exists: the deploy
-- repo's registry models `domain_mode` and (as of the sibling PR) `base_domain`,
-- and `provision-tenant.sh` enforces both. What did not exist is any way for a
-- partner to REGISTER such a zone, or any way for us to know it is theirs.
--
-- The verification columns are the point of this table, not decoration. Without a
-- proof, a partner types `google.com`, and the first client provisioned under it
-- makes us request a certificate for a name we do not own and serve traffic from
-- it. `verifiedAt IS NULL` is therefore the default state and every reader treats
-- it as unusable.
--
-- ADDITIVE AND SAFE ON A DB WITH LIVE ROWS: one new table, no column added to,
-- renamed on, or dropped from any existing one, no backfill, no data rewrite.
-- Nothing reads it until the surfaces in this PR do, so applying it before rolling
-- the app is a no-op for every running query plan.
--
-- UNIQUE (partnerId, domain), NOT UNIQUE (domain). A global unique would turn an
-- unverified claim into a squat: type a competitor's zone and they can never claim
-- it. Safety does not need it — each row carries its own random token, so control
-- of a zone can only ever be proven against the row that asked for it.

CREATE TABLE "PartnerDomain" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerDomain_partnerId_domain_key" ON "PartnerDomain"("partnerId", "domain");

CREATE INDEX "PartnerDomain_partnerId_idx" ON "PartnerDomain"("partnerId");

-- CASCADE: the rows are meaningless without the partner, and a deleted partner's
-- claim on a zone must not outlive them.
ALTER TABLE "PartnerDomain" ADD CONSTRAINT "PartnerDomain_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
