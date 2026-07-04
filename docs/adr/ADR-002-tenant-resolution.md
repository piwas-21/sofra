# ADR-002 — Tenant resolution: subdomains + custom domains

**Status:** accepted 2026-07-04

Each tenant gets `{slug}.<sofra-domain>` via a wildcard DNS record (managed
through domainio). Custom domains (rumirestaurant.ch is the standing reference
case) via explicit Caddy site blocks; graduate to Caddy on-demand TLS when
tenant count grows.
