# ADR-016 — Runtime tenant attribution

Status: accepted.

Partner branding is public display configuration held in Sofra's database. Brand edits and
site preferences do not create infrastructure PRs. Provisioning and tenant lifecycle stay
in the deploy registry (ADR-007/012); the control plane gains no box credentials.

`PartnerBrand` owns the public partner name and optional HTTPS website. Existing
`Client` / `TenantBilling` links determine ownership; ambiguous, stale or conflicting
links suppress attribution. `TenantBranding` stores only the tenant's enabled preference.
A partner action requires `requirePartner()` and an owned LIVE client, checks both mapping
directions, and writes the preference. Saving a published brand updates all enabled sites.

`GET /api/public/tenant-branding/{slug}` exposes only `{name,url,email}` for active registry
tenants, with an ETag. It is anonymous because the same values appear in guest footers.
Unknown/inactive tenants answer 404; unavailable DB or registry answers 503. Database failure
is never mistaken for an unpartnered tenant. The endpoint never exposes private billing
identity, partner contact details, notes or ownership IDs.

A genuinely unpartnered tenant displays the configured platform attribution from
`SOFRA_BRAND_NAME`, `SOFRA_BRAND_URL` and `SOFRA_BRAND_EMAIL`: Sofra, its website and company contact email. Missing or invalid platform configuration answers 503 for an unpartnered tenant. An assigned
partner whose brand is missing, unpublished, disabled or a legal-name echo renders no
credit; it never falls back to Sofra. Existing `partner_attribution: false` remains the
restaurant-owned veto and cannot be overridden by a partner preference.

Tenant backends pull with their configured slug, cache for 60 seconds, retry on bounded
timeouts, and expire unavailable snapshots after 300 seconds. Their existing
`/api/tenant/partner` contract adds nullable email. Dynamic mode never falls back to old
environment values, including after withdrawal. Frontend mounted footers refresh every
60 seconds. Publication normally propagates within two minutes. Ordering does not depend
on branding availability. Platform attribution does not replace restaurant identity or
contact data.

## Release and rollback

Apply the new migration with the migration image before rolling Sofra. Release Sofra's
read API, then backend and frontend. Deploy template runtime URL/slug mappings and use the
template-owned narrow migration for existing managed stacks; recreate only their backend.
Verify each tenant endpoint and both footer templates. Retain existing opt-outs.

To roll back attribution, remove runtime URL configuration and restore the prior backend/
frontend revisions. Do not delete preference records or rewrite tenant operational data.
Legacy branding PRs are superseded by the database flow and must not be merged afterwards.
