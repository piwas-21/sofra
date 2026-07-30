-- Payment-triggered provisioning (workspace docs/plans/SOFRA-ONBOARDING-PLAN.md, O3).
--
-- O3's remaining half is: when a self-serve tenant's first payment settles, open the
-- registry PR automatically instead of waiting for the founder to click
-- /admin/provision. That needs the configurator answers (modules/template/currency/
-- languages, on SignupRequest since O1) reachable FROM the billing row — and until now
-- they were not, in either direction.
--
-- The plan assumed they were. What actually existed was a SOFT join,
-- SignupRequest.desiredSlug = TenantBilling.tenantSlug, and it is not safe to provision
-- from: leads accumulate (every leadOnly outcome writes one), so two SignupRequest rows
-- can carry the same desiredSlug while only one of them minted the account. Matching on
-- it could hand a paying customer another lead's MODULE LIST. Today a human supplies the
-- id explicitly (/admin/provision?from=<id>); an unattended path has no human.
--
-- signupRequestId is therefore the durable link, written at intake by
-- createSelfServeAccount. NULL for every founder-created plan (/admin/onboard, the
-- reseller flow, and RUMI, which predates all of this), which is exactly the same
-- signal the payment gate already keys on: no lead ⇒ not self-serve ⇒ not our business
-- to automate.
--
-- Deliberately NOT unique, and the honest reason is the second one below, not the first:
--   * "tenantSlug is already @unique" does NOT cover this. That prevents two plans per
--     SLUG; a unique signupRequestId would prevent two plans per LEAD, which is a
--     different claim.
--   * What actually decides it: the state is unreachable (the id comes from a row created
--     in the same request), and adding a unique constraint on the signup path would add a
--     fresh P2002 surface inside the money-adjacent transaction — where the existing catch
--     is narrowed on `tenantSlug` (O2 fix #5), so a different violation would fall through
--     as an unexplained 500 mid-signup. A constraint whose only effect is a worse failure
--     mode for an impossible state is not worth having.
--
-- ON DELETE SET NULL: nothing prunes SignupRequest today (retention does not cover it),
-- but a dangling FK would be a worse way to find that out than a null.
--
-- provisioningPrUrl records the proposal that was opened, and doubles as the auto-open's
-- idempotency record: Mollie redelivers webhooks, so "have I already proposed this
-- tenant?" has to be answerable from our own rows and not only from GitHub refusing a
-- duplicate branch.
--
-- Both columns additive and nullable ⇒ safe on existing rows.

ALTER TABLE "TenantBilling" ADD COLUMN "signupRequestId"  TEXT;
ALTER TABLE "TenantBilling" ADD COLUMN "provisioningPrUrl" TEXT;

CREATE INDEX "TenantBilling_signupRequestId_idx" ON "TenantBilling"("signupRequestId");

ALTER TABLE "TenantBilling"
  ADD CONSTRAINT "TenantBilling_signupRequestId_fkey"
  FOREIGN KEY ("signupRequestId") REFERENCES "SignupRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
