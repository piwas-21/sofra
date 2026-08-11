# ADR-009 — Partner program model (v1)

Status: accepted 2026-07-05 (owner decisions P-D1..P-D3, SOFRA-PARTNER-PLAN);
**amended 2026-07-12 (reseller type) and 2026-08-11 (billing identity) — see the
two amendment sections at the end.**

## Decision

1. **Managed referral** (P-D1): partners find restaurants and own the
   relationship (client rows, notes, pipeline `LEAD → CONTACTED →
   DEMO_SCHEDULED → AGREED`); "request onboarding" flips to `ONBOARDING` and
   notifies the founder. Provisioning stays founder-operated (ADR-003/004);
   `LIVE` + `tenantSlug` and `CHURNED` are ADMIN-only. No partner-facing
   infra actions.
2. **Apply → founder approves** (P-D2): public localized form → admin queue
   → approve mints a hashed, single-use, 24h set-password invite (link also
   surfaced in the admin UI as email-delivery backup). No open registration.
3. **Commission ledger in v1** (P-D3): `CommissionEntry` rows recorded
   manually by the founder (CHF cents, negative = payout); partners see a
   read-only ledger + running balance. Payout automation waits for Mollie
   (ADR-005).

## Security posture

- All partner queries scoped `where: { partnerId: session.user.id }` server-side.
- Public endpoints rate-limited + honeypot; login rate-limited inside
  `authorize()` (per-IP and per-account) with a constant-time bcrypt path.
- `AuditLog` on logins (incl. failures), application decisions, status
  changes, commission entries.
- Tenant knowledge in this app is limited to the `tenantSlug` string.

## Later (explicitly out of v1)

Reseller tier / white-label, partner asset kit, Mollie-automated commissions,
dashboard i18n, disable-partner admin action (DISABLED status exists in the
schema; setting it is manual SQL for now — tokens from disabled users are
already refused).

## Amendment (2026-08-11) — a partner is a legal entity, not just a login

Owed since 2026-07-12 and recorded here at last, together with what B1 added.

**The reseller type is first-class** (SOFRA-PARTNER-PLAN §9): a *reseller*
partner PAYS Sofra a wholesale rate per tenant and keeps their own markup, while
a *commission* partner EARNS from the P-D3 ledger. It is not a schema role — the
dashboard derives the surface from what the partner actually has — and one
partner can be both.

**What B1 changes about this model:** a partner is now also a `BillingIdentity`
— a legal name, a registered address, a registration number and a VAT number —
because a reseller is INVOICED, and an invoice needs a party. Three consequences
for anything touching partners:

- The identity is attached to the **User**, not to the plan, so a reseller
  holding several tenants is one legal entity. `PartnerProfile.company` remains
  a free-text CRM note and is **not** the legal name; do not read it as one.
- A reseller's first payment for a new tenant is **gated** on that identity being
  complete. Existing ACTIVE subscriptions are unaffected.
- The commission direction is still unmodelled: when Sofra PAYS a partner, the
  partner invoices Sofra, or Sofra self-bills under a prior written agreement.
  `CommissionEntry` is an amount and a note, and remains so. This is the largest
  remaining gap in the partner model.
