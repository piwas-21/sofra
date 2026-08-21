-- What language do we write to this customer in? (EMAIL-SPEC-CONTROL-PLANE G9.)
--
-- The control plane has held a locale for every INTAKE since the day the intakes
-- were built — `SignupRequest.locale`, `PartnerApplication.locale` — and the
-- trial-ending mail (sofra #167) proved the sending pattern that reads one. What
-- it has never held is a locale for a PERSON. An intake row is consumed and left
-- behind: it belongs to the lead, not to the account the lead became, and nothing
-- links it back once a partner holds a second tenant or an owner is invited by the
-- founder rather than through the funnel.
--
-- So every mail addressed to a USER — the invite, the re-send, the password reset,
-- the invoice — had no locale to read and stayed English, in a product that sells
-- in Geneva and ships six languages. This column is that locale.
--
-- NOT NULL with a default of 'en', deliberately, and it is the honest reading of
-- the rows that exist: they were all written English mail, so 'en' is what they
-- actually received. A nullable column would add a third state ("unknown") that
-- every reader would have to collapse to 'en' anyway — `emailLocale()` already
-- falls back to the default locale for a value it does not ship, which covers a
-- locale we later drop without a data migration.
--
-- No CHECK constraint on the value: the set of locales is a product decision that
-- changes in `i18n/routing.ts`, and a database constraint that has to be migrated
-- in lockstep with a TypeScript array is one that will eventually disagree with
-- it. The read path is total (`emailLocale`), which is where the guarantee belongs.
--
-- No index: it is read by id, never selected on.

ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';

-- BACKFILL from the intakes, which is where the control plane has been keeping this
-- all along. Not cosmetic: the one live reseller applied in FRENCH
-- (`PartnerApplication.locale = 'fr'`, 2026-08-14), and the trial-ending sweep
-- already writes to him in French by looking his address up in that table at send
-- time. Without this, his account would default to 'en' and every OTHER mail —
-- invite re-send, password reset, invoice — would arrive in a language he did not
-- choose, while one mail arrived in the language he did. Two answers to the same
-- question is worse than one wrong one.
--
-- `DISTINCT ON (lower(email)) … ORDER BY … "createdAt" DESC` takes the MOST RECENT
-- intake per address: someone who applied twice means the second one.
--
-- Role-matched on both sides: an application makes a PARTNER and a signup makes an
-- OWNER (ADR-004), and matching on the address alone would let a founder's own test
-- signup rewrite an admin account's language.
--
-- No locale-value filter here on purpose. The set of shipped locales lives in
-- `i18n/routing.ts`, and `emailLocale()` already falls back to the default for a
-- value it does not recognise — so a locale we later drop degrades to English at
-- READ time rather than needing a data migration on the day it is dropped.

UPDATE "User" u
SET "locale" = a."locale"
FROM (
  SELECT DISTINCT ON (lower("email")) lower("email") AS "email", "locale"
  FROM "PartnerApplication"
  ORDER BY lower("email"), "createdAt" DESC
) a
WHERE lower(u."email") = a."email" AND u."role" = 'PARTNER';

UPDATE "User" u
SET "locale" = s."locale"
FROM (
  SELECT DISTINCT ON (lower("email")) lower("email") AS "email", "locale"
  FROM "SignupRequest"
  ORDER BY lower("email"), "createdAt" DESC
) s
WHERE lower(u."email") = s."email" AND u."role" = 'OWNER';
