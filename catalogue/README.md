# Catalogue authoring

This directory contains Sofra-owned catalogue manifests. Keep every revision
append-only: a changed revision gets a new revision number, and an existing
revision must never be edited after it is published.

The initial Turkish starter pack is generic Sofra-authored copy, approved for
publication by a restaurant operator in
`reviews/tr-starter-v1-2026-09-28.md`. It contains no recipe, ingredient,
allergen, nutrition, dietary, portion, price, or operational claims. Imported
entries remain suggestions; each tenant confirms local facts and operating
choices before creating operational records.

Pack inclusion defaults are only the initial selection in a tenant's review UI. They
never import, activate, or publish tenant records by themselves.

Run `npm run catalogue:validate` before review or publication. The report lists
locale coverage and publication blockers for every revision. The publisher is
an explicit one-off command, `CATALOGUE_DATABASE_URL=... node
scripts/catalogue/sync-manifests.mjs`; it loads only the manifests in this
directory. Unpublished drafts remain in version-controlled source and are not
inserted into the catalogue database. After operator, editorial, rights and
locale reviews are complete, mark the manifest reviewed and published, then
run the publisher. It inserts that immutable revision and appends its publication
event in one transaction. Later content changes require a new revision; hiding a
published revision requires an explicit withdrawal manifest. The runtime reader
role can see only reviewed revisions with a publication event.

The public read API exposes paginated published summaries, exact published
revisions, and `GET /api/v1/catalogue/templates/{templateId}/current`. The current
endpoint returns `{templateId, revision, contentHash, withdrawn,
adoptedRevisionWithdrawn}`; pass `?adoptedRevision=N` to check the status of a
tenant's pinned revision. A known but wholly withdrawn template returns 200 with
`revision` and `contentHash` null, while a never-published template returns 404.
For revision review across a tenant import session,
`POST /api/v1/catalogue/templates/current-batch` accepts up to 128 distinct
`{templateId, adoptedRevision}` pairs in a 64 KiB request. It returns each
template's `available`, `withdrawn`, or `notFound` status, the full current
reviewed revision only when available, and the pinned revision's withdrawal
status. The route reads published views in one query and returns 503 if that
read fails; callers must not interpret 503 as a clean or current template.
Reader access is limited to status views of revisions published at least once;
draft content and raw publication events are not exposed.

The catalogue migration is also an explicit one-off; the migrate image's default
command remains for the control-plane database. Run
`sh scripts/catalogue/migrate-deploy.sh` with the owner `CATALOGUE_DATABASE_URL`.

The database regression requires an already migrated disposable PostgreSQL
database named `sofra_catalogue_test` on localhost. Set
`CATALOGUE_TEST_DATABASE_URL` to its owner connection, then run
`npm run test:catalogue:db`. It verifies draft-to-published flow, event
idempotency, withdrawal status, reader permissions, and the database
immutability trigger. The test refuses non-local
hosts and other database names.

Do not copy tenant menus, product names, descriptions, images, prices, or
operational identifiers into this directory. Record provenance and licensing
for any future external material or media.
