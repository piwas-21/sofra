# Catalogue authoring

This directory contains Sofra-owned catalogue manifests. Keep every revision
append-only: a changed revision gets a new revision number, and an existing
revision must never be edited after it is published.

The initial Turkish starter pack is generic Sofra-authored draft copy. It was
not reviewed by a restaurant operator and contains no recipe, ingredient,
allergen, nutrition, dietary, portion, price, or operational claims. Imported
entries remain suggestions; each tenant confirms local facts and operating
choices before creating operational records.

Pack inclusion defaults are only the initial selection in a tenant's review UI. They
never import, activate, or publish tenant records by themselves.

Run `npm run catalogue:validate` before review or publication. The report lists
locale coverage and publication blockers for every revision. The publisher is
an explicit one-off command, `CATALOGUE_DATABASE_URL=... node
scripts/catalogue/sync-manifests.mjs`; it loads only the manifests in this
directory. `unpublished` revisions may be stored centrally, but the runtime
reader role can see only revisions that pass review and have a publication
event. Publication must not be enabled until restaurant-operator approval and
editorial review evidence are recorded in the manifest.

Do not copy tenant menus, product names, descriptions, images, prices, or
operational identifiers into this directory. Record provenance and licensing
for any future external material or media.
