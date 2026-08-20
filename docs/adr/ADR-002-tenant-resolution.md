# ADR-002 — Tenant domains: subdomain, bring-your-own, partner zone, or buy-through-Sofra

**Status:** accepted 2026-07-04; **v2 amended 2026-07-05** (adds the
buy-through-Sofra path via the domainio agent API; owner decision);
**v3 amended 2026-08-20** — adds path **1b, a partner's own base domain**
(SOFRA-PARTNER-FLEXIBILITY-PLAN §D1), and CORRECTS §3's prerequisites, which were
wrong on four counts and unsourced on a fifth.

Every tenant gets exactly one of **four** domain setups:

## 1. Included subdomain (default)

`{slug}.sofrapiwas.com` via a wildcard DNS record (managed through domainio).
Free with every plan; the slug is the tenant-registry key (ADR-007).

## 1b. A partner's own base domain (new in v3)

`obresse.solutioneva.com` — **one partner-owned zone, N tenants under it.** Neither
of the two original paths covers it: path 1 hardcodes `sofrapiwas.com`, and path 2
means a domain belonging to *the restaurant*, one per tenant.

Modelled as a **sibling field on `domain_mode: subdomain`**, not as a fourth mode:

```yaml
  obresse:
    domain: obresse.solutioneva.com
    domain_mode: subdomain
    base_domain: solutioneva.com      # absent = sofrapiwas.com (every existing entry)
```

Absence is the contract — every entry that exists today is unchanged, and
`provision-tenant.sh` reads an absent `base_domain` as `sofrapiwas.com`.

**DNS: a per-client A record, published by the partner** (owner decision O-D1,
2026-08-20). Two alternatives were weighed and are recorded so they are not
re-proposed: a **wildcard** `*.solutioneva.com` remains available but is discouraged
and never offered without stating its blast radius (it takes over the default answer
for the partner's whole company zone); a **delegated subzone** — the attractive
zero-touch option — is **impossible, not merely worse**. domainio does not run
nameservers; it resells ResellerClub's `*.orderbox-dns.com` cluster, and every call
it makes is `order-id`- or `domain-name`-scoped to an order inside its own RC
reseller account, so a zone RC does not hold yields `null` from
`/domains/orderid.json` and every call fails closed. Hosting a delegated subzone
would need domainio's own authoritative DNS plus a data model for zones it does not
own; neither exists.

**The partner must PROVE the zone before it is usable.** A claim is stored
unverified with a random token; the partner publishes
`TXT _sofra-verify.<domain> = sofra-verify=<token>`; we resolve it server-side and
stamp `verifiedAt`. Without this, a partner could claim `google.com` and we would
issue a certificate for, and serve content from, a name we do not control. Proofs
are re-checkable, staleness (>180 days) is surfaced to the founder, and nothing is
auto-revoked — an auto-revoke cannot unpublish tenants already served from the zone,
so it would remove only the partner's ability to place the next client.

**Certificates are per-hostname over HTTP-01, so the A record must resolve BEFORE
provisioning.** There is no way to pre-issue. A tenant provisioned ahead of its
record stands up without TLS, which looks exactly like a broken product — hence the
`dig +short` pre-flight in the provisioning PR body.

The partner **proposes**; the founder still merges the registry PR (ADR-003/007). No
control-plane surface writes the registry.

**Consequence worth restating:** `NEXT_PUBLIC_*` are baked per domain and each tenant
already gets its own image, so this costs no new mechanism — but *changing* a live
tenant's domain later is an image rebuild plus a re-provision, not a registry edit.

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

**Prerequisites — CORRECTED 2026-08-20.** The v2 wording below was wrong on four
counts and unsourced on a fifth. Evidence: the domainio agent's own read-only survey
of `piwas-21/domainio` @ `139c09b` (`.claude/research-findings.md`, Q2 and Q4), plus
SOFRA-PARTNER-FLEXIBILITY-PLAN §D3.

1. **An organisation is NOT required.** A *personal* key with `domains:write` +
   `dns:write` works on `POST /api/domains/register` and `POST /api/domains/[id]/dns`
   — neither route goes through the org-auth middleware. v2 said "create a Sofra
   organization + org-scoped key"; that is unnecessary.
2. **An org key would not help anyway.** Runtime access-scoping for org keys is an
   unshipped follow-up (the service file says so in its own header), and registration
   deducts the **key owner's PERSONAL `AccountBalance`**, never `OrgBalanceService`.
   The budget envelope to use is a `spendLimit` on the key itself.
3. **`RC_MOCK_MODE` defaults to `true`** in domainio's `.env.example`. An untouched
   deployment silently returns fake `mock-order-…` ids and charges nothing, so a real
   registration needs it explicitly `false`. This is the failure that looks like
   success.
4. **A `dk_test_` key sandboxes NOTHING on these endpoints.** `isSandboxRequest` is
   only consumed by the `withAgentAuth` HOF, which these two routes do not use, and no
   route reads `ctx.isSandbox` at all. Live-versus-mock is decided solely by the
   SERVER's env. There is no safe way to rehearse against a production domainio with a
   test key.
5. **The "~15 min orderbox NS convergence" figure is UNSOURCED** and is downgraded to
   a guess. It was carried here from a one-off 2026-07-05 observation; a grep of the
   whole domainio repo (`app/ lib/ docs/ e2e/ scripts/ __tests__/`) found no
   measurement, constant, doc, test or comment supporting *or* contradicting it. Until
   it is measured — register a name, then poll **registry delegation**, the
   **authoritative answer** and the **public resolvers** separately, because they
   converge at different rates and querying a public resolver too early poisons the
   measurement with a cached NXDOMAIN — any buy-a-domain UI must promise a vague
   "shortly" rather than a number we cannot stand behind.

Still true, and still the blocker:

- **domainio#231**: `activateDNS` passes `domain-name` where ResellerClub's
  `dns/activate.json` needs `order-id`, so a freshly registered domain cannot receive
  DNS records via the API. The workaround is activating from the domainio prod box
  (the only RC-whitelisted IP), which is not something this product can call. Until it
  is closed, "buy through Sofra" ends with a domain we own and cannot point anywhere.
- **Owner action**: mint the personal `domains:write` + `dns:write` key (live), set a
  `spendLimit`, top up the prepaid balance. The key lives only in the box `.env`.

**This path is therefore NOT offered.** The partner-facing chooser renders it as
explicitly unavailable and the server refuses the choice independently, so a stale
client bundle cannot submit it.

## Which path a tenant is on, and who chooses

| path | registry | who publishes DNS | chosen by |
|---|---|---|---|
| 1 subdomain | `domain_mode: subdomain`, no `base_domain` | nobody (wildcard) | partner or founder |
| 1b partner zone | `domain_mode: subdomain` + `base_domain:` | **partner**, one A record per client | partner proposes (verified zones only), founder merges |
| 2 bring-your-own | `domain_mode: byo` | **the restaurant** | partner proposes, founder merges |
| 3 buy through us | — | us | **not offered** (blocked, see §3) |

## Renewal & lifecycle (all paths)

Path-3 domains renew through the same balance flow (billed to the tenant with
their subscription — ADR-011); path-2 renewals are the tenant's own
responsibility. If a tenant leaves, path-3 domains are pushed to their own
domainio account (domainio has domain-push) — we sell convenience, not lock-in.
