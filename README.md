# Sofra

**Sofra** (Turkish: a table laid for guests) is the restaurant-management SaaS grown
out of the system running [RUMI Restaurant, Geneva](https://www.rumirestaurant.ch) —
QR menus & ordering, live order boards (kitchen/cashier/server), reservations,
loyalty points, thermal-printer companion app, 10 locales.

This repo is **live at https://sofrapiwas.com**: the marketing site + the control
plane (partner program — Auth.js v5 credentials/JWT + Prisma 7 on Postgres).
Next.js 15 App Router, Tailwind, next-intl (en/fr/de/nl/tr/ar — ar is RTL;
control plane is en-only, outside `[locale]`). Design system: craft/handmade — see
[docs/design-tokens.md](docs/design-tokens.md). Architecture decisions: [docs/adr/](docs/adr/) (ADR-001–011).

Master plan: `rumi-workspace/docs/plans/SOFRA-SAAS-PLAN.md`; partner program:
`rumi-workspace/docs/plans/SOFRA-PARTNER-PLAN.md`; AEO: `rumi-workspace/docs/plans/SOFRA-AEO-PLAN.md`.

## Develop

```bash
npm install
docker run -d --name sofra-dev-pg -p 5434:5432 \
  -e POSTGRES_USER=sofra -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sofra postgres:16
cp .env.example .env   # set AUTH_SECRET (openssl rand -base64 32); DATABASE_URL matches the container above
npx prisma migrate deploy
npm run dev            # http://localhost:3000 → redirects to /en; control plane at /login
```

- Waitlist form needs `RESEND_API_KEY` + `WAITLIST_TO`; without them the API
  returns 503 and the form shows a mailto fallback.
- Control plane needs `DATABASE_URL` + `AUTH_SECRET` (+ `NEXTAUTH_URL` for links in emails).
- End-to-end check (no browser needed): `node scripts/e2e-local.mjs` — drives the
  full partner journey (20 checks) against the local dev server + DB.

## Deploy

Push to `main` → `build-image.yml` publishes `ghcr.io/piwas-21/sofra:latest`
**and** `:migrate` (one-off DB tooling) → the staging box pulls via the
`restaurant-app-deploy` compose stack (profile `sofra`, behind Caddy).
Migrations/seed are founder-run one-offs from the `:migrate` image — never on
container start. Full runbook: `restaurant-app-deploy/DEPLOYMENT.md`
("Sofra control plane" section).
