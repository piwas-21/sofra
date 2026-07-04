# Sofra

**Sofra** (Turkish: a table laid for guests) is the restaurant-management SaaS grown
out of the system running [RUMI Restaurant, Geneva](https://www.rumirestaurant.ch) —
QR menus & ordering, live order boards (kitchen/cashier/server), reservations,
loyalty points, thermal-printer companion app, 9 locales.

This repo is the **marketing site + (future) control plane**: Next.js 15 App Router,
Tailwind, next-intl (en/fr/tr). Design system: craft/handmade — see
[docs/design-tokens.md](docs/design-tokens.md). Architecture decisions: [docs/adr/](docs/adr/).

Master plan: `rumi-workspace/docs/plans/SOFRA-SAAS-PLAN.md` (piwas-21/rumi-workspace).

## Develop

```bash
npm install
npm run dev        # http://localhost:3000 → redirects to /en
```

Waitlist form needs `RESEND_API_KEY` + `WAITLIST_TO` (see `.env.example`);
without them the API returns 503 and the form shows a mailto fallback.

## Deploy

Push to `main` → `build-image.yml` publishes `ghcr.io/piwas-21/sofra` →
the box pulls it via the `restaurant-app-deploy` compose stack (staging box,
behind Caddy). See SOFRA-SAAS-PLAN Phase 4.
