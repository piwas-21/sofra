# ADR-003 — Provisioning: scripts first, control-plane later

**Status:** accepted 2026-07-04

Per-tenant `.env` + compose project templated from the deploy repo's
`docker-compose.prod.yml`; a `provision-tenant.sh` evolved from
`provision.sh`/`gen-secrets.sh`; DNS record via `domainio-dns.sh`.
Founder-operated at first; the control plane later calls the same scripts —
no parallel mechanism.
