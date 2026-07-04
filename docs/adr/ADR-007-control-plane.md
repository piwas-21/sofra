# ADR-007 — Control-plane placement & tenant registry

**Status:** accepted 2026-07-04

One Next.js app (this repo) hosts marketing + dashboard route groups
(mirroring domainio's structure). Tenant registry starts as the simplest thing
that works — a committed YAML/JSON in the deploy repo (already the infra source
of truth) until >3 tenants, then a Postgres table on the staging box.
