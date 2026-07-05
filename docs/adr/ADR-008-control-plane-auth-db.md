# ADR-008 — Control-plane auth & database stack

Status: accepted 2026-07-05 (Track S / SOFRA-PARTNER-PLAN P1)

## Context

The partner program (SOFRA-PARTNER-PLAN) is the first control-plane feature:
it needs accounts, sessions, and persistence inside the sofra app. domainio
(the design/pattern donor) runs NextAuth v4 + Prisma 5 on Next 15 / React 18.

## Decision

- **Auth.js v5 (next-auth@beta), credentials provider, JWT sessions.** Not
  domainio's NextAuth v4: sofra is React 19 and v4 pins React ≤18 peer deps.
  Same shape otherwise — bcrypt (cost 12) password hashes, no DB sessions,
  `trustHost: true` behind Caddy. This was the "decide at P1" fallback the
  plan reserved, exercised.
- **Prisma 7 + `@prisma/adapter-pg`** (no Rust engines — pure-JS client
  engine), PostgreSQL. Connection URL lives in `prisma.config.ts` (CLI) and
  `lib/db.ts` (runtime adapter), per Prisma 7's removal of schema-file URLs.
- **Database: `sofra` DB + dedicated role on the staging box's existing
  postgres container** — DB-per-concern on a shared server, mirroring
  ADR-001; RUMI staging's `restaurantdb` untouched.
- **Migrations are founder-run, never on container start**: the CI publishes
  a sibling `ghcr.io/piwas-21/sofra:migrate` image (full deps + prisma CLI +
  seed script); the slim runtime image ships no DB tooling.
- **Control plane is English-only and lives outside `[locale]`** (second
  root layout `(control)`), excluded from the next-intl middleware matcher.

## Consequences

- Rate limiting is in-memory (single container). Horizontal scaling would
  need Redis — explicitly out of scope for v1.
- Auth.js v5 is a beta tag; pin exact versions in lockfile and re-test on
  bumps (the E2E suite `scripts/e2e-local.mjs` covers the full auth surface).
- Every control-plane page/action re-checks the role server-side
  (`lib/rbac.ts`); layouts are chrome, not security boundaries.
