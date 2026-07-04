# ADR-001 — Multi-tenancy & isolation: instance-per-tenant

**Status:** accepted 2026-07-04

Each restaurant runs as its own Docker Compose project (frontend + backend
containers) on a shared box. One shared Postgres server per box, one database +
role per tenant (cheap on RAM vs per-tenant PG containers; per-tenant `pg_dump`
keeps backup/restore per-tenant). Redis: per-tenant DB index or per-tenant
container — verify the backend has no DB-0 assumption first.

**Explicitly rejected for now:** row-level tenancy retrofit (RestaurantId
columns + query filters across ~41 entities). Revisit only if tenant count
makes per-instance overhead real (rough threshold: ~10+ tenants or a box-RAM
ceiling).
