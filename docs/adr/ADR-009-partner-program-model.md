# ADR-009 — Partner program model (v1)

Status: accepted 2026-07-05 (owner decisions P-D1..P-D3, SOFRA-PARTNER-PLAN)

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
