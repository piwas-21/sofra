# ADR-010 — Module catalog & packaging: Core + bundles + à la carte

**Status:** accepted 2026-07-05 (owner decision; catalog/pricing first,
enforcement later)

## Packaging model

- **Core** (every tenant): QR menu + online ordering, basic admin (menu
  management, restaurant settings, orders overview), one language beyond
  English.
- **Bundles** (curated, fight choice paralysis): **«Counter»** (Core + cashier
  + Z-report + kitchen board + thermal printing) and **«Full service»**
  (Counter + server/table service + reservations + loyalty). Names/pricing may
  change at marketing time.
- **À la carte add-ons** (flat monthly price each), mapped to what the RUMI
  app already has today:

| Module | Maps to (existing RUMI surface) |
|---|---|
| Kitchen board | `/kitchen-staff` live view (SSE) |
| Cashier + Z-report | `/cashier`, Z-report query + PDF |
| Server / table service | `/server`, TakeOrderModal, table layout |
| Reservations | `/reservations` + admin reservations-management |
| Loyalty points | fidelity points + customer groups/discount rules |
| Thermal printing | printer-app companion (Windows/Android) + printer feed API |
| Online payments | tenant→end-customer payments — **ADR-011 Job B (Stripe Connect)** |
| Custom / bought domain | ADR-002 paths 2–3 (bought domains carry the domainio-markup price) |
| Extra languages | beyond Core's en+1, up to the 9 shipped locales |
| Analytics | later — checkout-funnel events exist, no tenant-facing UI yet |

Reference model: GloriaFood (free core + flat-price add-ons) — copy the
acquisition hook, avoid their pricing opacity; **verify their current prices
before publishing any comparison** (2026 numbers unconfirmed).

## Enforcement (under instance-per-tenant, ADR-001)

Module flags live in the **tenant registry** (ADR-007) → provisioning
(ADR-003) writes them into the tenant's `.env`/config → the tenant instance
gates: frontend hides routes/nav, backend rejects endpoints (authz-level, not
UI-only). No per-request tenant lookup — flags are baked per instance and
change via re-provision.

## v1 scope

Catalog + pricing sheet + registry fields **only**. No enforcement code yet:
RUMI (tenant 1) keeps everything enabled, and building gates before tenant 2
exists is speculative work. Enforcement ships with real tenant-2 provisioning.
