-- Public signup configurator (workspace docs/plans/SOFRA-ONBOARDING-PLAN.md, O1).
--
-- Until now a SignupRequest carried contact details only; every product decision
-- (modules, theme, languages, currency) was typed by the founder later at
-- /admin/provision. These columns let the customer make those choices themselves.
--
-- Additive and fully nullable, so this is safe on existing rows: a lead captured
-- before the configurator shipped simply has NULLs, which the admin UI renders as
-- "founder chooses" — the exact behaviour every existing lead already had.
--
-- modules/languages are comma-separated text, not text[], deliberately: that is
-- the grammar tenants/registry.yml and provision-tenant.sh already consume, so the
-- answers reach the tenant env without a format change. They are opaque payload
-- carried to the provisioner, never queried by element.
--
-- quotedCents is EUR integer cents (repo money rule) and is a RECORD of what the
-- lead was shown, not a binding price — onboarding re-quotes from the live catalog.

ALTER TABLE "SignupRequest" ADD COLUMN "modules"     TEXT;
ALTER TABLE "SignupRequest" ADD COLUMN "languages"   TEXT;
ALTER TABLE "SignupRequest" ADD COLUMN "template"    TEXT;
ALTER TABLE "SignupRequest" ADD COLUMN "currency"    TEXT;
ALTER TABLE "SignupRequest" ADD COLUMN "quotedCents" INTEGER;
