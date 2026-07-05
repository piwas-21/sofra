# ADR-002 — Tenant domains: subdomain, bring-your-own, or buy-through-Sofra

**Status:** accepted 2026-07-04; **v2 amended 2026-07-05** (adds the
buy-through-Sofra path via the domainio agent API; owner decision).

Every tenant gets exactly one of three domain setups:

## 1. Included subdomain (default)

`{slug}.sofrapiwas.com` via a wildcard DNS record (managed through domainio).
Free with every plan; the slug is the tenant-registry key (ADR-007).

## 2. Bring your own domain

Tenant already owns a domain (rumirestaurant.ch is the standing reference
case): they point DNS at the box, we add an explicit Caddy site block.
Graduate to Caddy on-demand TLS when tenant count makes per-tenant site
blocks tedious.

## 3. Buy a domain through Sofra (new in v2)

Powered by **domainio's agent API** (Sofra is an ordinary API consumer with an
org-scoped key — no special coupling):

- **Search/availability:** `GET /api/domains/search` + `/api/domains/check`.
- **Price:** `GET /api/pricing` (+ `/api/price/[tld]`) returns domainio's
  consumer prices (1h cache). **Tenant-visible price = domainio price + Sofra
  margin** (margin per TLD, owner-set — covers cost + support; keep it visible
  and honest in the tenant-facing UI).
- **Register:** `POST /api/domains/register` with a `domains:write` agent key.
  The flow is deduct-before-register from **Sofra's prepaid domainio balance**
  with automatic refund on registration failure (domainio
  `lib/services/agent-registration.ts` contract) — no interactive checkout
  needed. Spend limits + budget checks live on the key itself.
- **Point at the box:** `POST /api/domains/[id]/dns` (A records; same API the
  `domainio-dns.sh` script uses today).

**Prerequisites** (tracked in the workspace BACKLOG §Sofra):
- Create a Sofra organization + `domains:write` agent API key in domainio
  (live mode), top up a prepaid balance. Key lives only in the box `.env`.
- domainio#231 must be fixed first: `activateDNS` passes `domain-name` where
  ResellerClub's `dns/activate.json` needs `order-id`, so freshly registered
  domains can't get DNS records via the API (current workaround: activate from
  the domainio prod box, the only RC-whitelisted IP). Also expect ~15 min
  orderbox NS convergence on fresh zones before issuing certs.

## Renewal & lifecycle (all paths)

Path-3 domains renew through the same balance flow (billed to the tenant with
their subscription — ADR-011); path-2 renewals are the tenant's own
responsibility. If a tenant leaves, path-3 domains are pushed to their own
domainio account (domainio has domain-push) — we sell convenience, not lock-in.
