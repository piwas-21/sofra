# Sofra — Agent Rules

> Auto-loaded by Claude Code on every session in this repository. These rules apply to ALL changes in `sofra/`.
> This app is **LIVE at https://sofrapiwas.com** (marketing site + control plane) and **bills real money** (Mollie, `live_` key since 2026-07-07). Work accordingly.

---

## §1 — Identity

- **Stack**: Next.js 15 (App Router) · React 19 · TypeScript · **Tailwind** ("craft" design system) · next-intl (site: en/fr/de/nl/tr/ar, `ar` = RTL) · Auth.js v5 beta (Credentials + JWT) · Prisma 7 + `@prisma/adapter-pg` · Mollie (subscriptions)
- **Two surfaces, one app**: `app/[locale]/` = localized public marketing site; `app/(control)/` = **English-only** control plane (admin `/admin`, partner `/dashboard`) with its own root layout.
- **Deliberately NOT bound by the frontend repo's rules**: Tailwind (not CSS Modules), `.dark` class dark mode (not `html[data-theme]`), craft tokens (not RUMI tokens). Do not import frontend conventions here.
- **Hosting**: runs on the **staging Netcup box** (`159.195.34.105`) behind Caddy, image `ghcr.io/piwas-21/sofra`; Postgres = shared `postgres` container, DB/role `sofra`. Infra source of truth: `deploy/` repo (`DEPLOYMENT.md` §Sofra control plane).
- **Workspace context**: one of five repos under the `rumi-workspace` meta-repo — master plan `docs/plans/SOFRA-SAAS-PLAN.md`, roadmap Track S.

## §2 — Where to look

| When | Read |
|---|---|
| Any architectural question | `docs/adr/` — ADRs 001–011 (tenancy, provisioning, control plane, partner model, modules, billing split) |
| Partner program / CRM semantics | ADR-009 + workspace `docs/plans/SOFRA-PARTNER-PLAN.md` (Client = CRM row; Tenant = registry entry; joined only by `tenantSlug`) |
| Billing work | ADR-005/ADR-011 + `lib/billing.ts` (fetch-and-verify, ACTIVATING claim, idempotency) |
| Deploy/migrate/ops | deploy repo `DEPLOYMENT.md` §Sofra control plane + the `operating-rumi-infra` skill |
| Manual QA logins | workspace `docs/runbooks/sofra-test-accounts.md` (ADMIN + PARTNER test accounts; **never run billing flows from them** — the key is live) |

## §3 — Architecture (load-bearing patterns)

- **RBAC**: `lib/rbac.ts` — `requireUser()` / `requireAdmin()` / `requirePartner()`. **Every** `(control)` page AND server action AND route handler guards itself; layouts are chrome, not security boundaries (ADR-008). `middleware.ts` is locale routing only — it protects nothing.
- **Auth**: Credentials-only, JWT sessions, bcrypt cost 12 (`bcryptjs`). Login requires `User.status='ACTIVE'` + non-null `passwordHash`. Anti-enumeration dummy-hash compare + IP/email rate limits live in `lib/auth.ts` — keep them.
- **Mollie webhook** (`app/api/webhooks/mollie/route.ts`): **unsigned by design** → never trust the body; re-fetch by id and verify (fetch-and-verify). Activation uses an atomic `ACTIVATING` claim + per-plan `Idempotency-Key`; a not-yet-valid mandate returns **503** so Mollie retries (mandate race, PR #13). Money = **EUR integer cents**.
- **Tenant registry**: `lib/tenant-registry.ts` reads the deploy repo's `registry.yml` (bind-mounted `:ro`, `TENANT_REGISTRY_PATH`). **Read-only seam** (ADR-007) — lifecycle changes happen in the deploy repo, never here.
- **DB**: Prisma 7, no Rust engines; connection URL lives in `prisma.config.ts` (reads `.env.local` in dev), runtime adapter in `lib/db.ts`.
- **Email**: Resend HTTP API (`lib/email.ts`); links built from `NEXTAUTH_URL`.
- **Server actions are progressively enhanced**: they must work as plain form POSTs (that's what `scripts/e2e-local.mjs` exercises, 20 checks). Don't wrap actions in inline client components that break no-JS submission.

## §4 — File length limits (workspace defaults)

Page 200 · component 250 · server action / lib file 200 · type file 150 LOC. Enforced by `scripts/check-single-file.mjs`: a PostToolUse hook warns in-loop after each edit, and `--all` mode fails CI (`file_length` job) on any over-limit file not in `scripts/file-length-baseline.txt`. Grandfathered files go in that baseline (currently `lib/billing.ts`); remove a line once refactored under limit. The checker also warns on emails/phones inside `console.*` (§5.8 PII rule).

## §5 — Hard rules

1. **Every new `(control)` surface calls its `require*()` guard first** — page, action, and route handler alike.
2. **Migrations are handwritten SQL one-offs**: create `prisma/migrations/<ts>_name/migration.sql` by hand (`prisma migrate dev` refuses non-TTY here), apply with `migrate deploy` via the `ghcr.io/piwas-21/sofra:migrate` image on the box — **never on container start, never edit an applied migration**.
3. **Never trust webhook bodies** — fetch-and-verify only (§3).
4. **Dark mode = `.dark` class** (Tailwind `darkMode: "class"`). `html[data-theme]` belongs to the tenant frontend, not here.
5. **Craft tokens only**: colors/fonts come from `tailwind.config.ts` (`craft.*`, HSL vars in `app/globals.css`) — no ad-hoc hex in components.
6. **Marketing strings are localized** (next-intl message files ×6, keep key parity; `ar` is RTL — check mirrored layouts). The `(control)` plane is **en-only by design** — do not localize it (that's tracked as sofra #9, a deliberate later).
7. **Money in EUR integer cents**; ledger currency is EUR (NL company).
8. **No PII in logs** — no partner/client emails, names, phones, or Mollie customer ids in console output.
9. **Env at the edges**: secrets only via env (`AUTH_SECRET`, `DATABASE_URL`, `MOLLIE_API_KEY`, `RESEND_API_KEY`); never committed, never logged. `$` values in box `.env` must be `$$`-escaped (compose interpolation).
10. **Registry is read-only from this app** (§3).

## §6 — Pre-implementation verification (non-trivial work)

Output before writing code: (1) which `require*()` guard covers each new surface; (2) schema change? → migration plan (handwritten SQL + box apply step in the PR's deploy notes); (3) marketing UI string change? → 6-locale parity list; (4) billing-state change? → walk the PENDING→ACTIVATING→ACTIVE machine and say why nothing strands (Mollie only redelivers on non-2xx); (5) sibling-convention check (2–3 neighboring files).

## §7 — Quality gates

- **CI** (`.github/workflows/ci.yml`): typecheck · eslint · next build · prisma migrations-apply + drift check · **vitest unit** · **i18n parity (6 locales)** · **file-length** · **playwright login smoke** · gitleaks · TruffleHog · Trivy fs · npm audit · OSV · semgrep; weekly `security-audit.yml`. SonarCloud autoscan (no CI job — don't add one).
- **Review gate ACTIVE in this repo** (since 2026-07-07): Stop + PreToolUse + PostToolUse (file-length checker) hooks (`.claude/settings.json`) + git pre-push → workspace `scripts/review-gate/` with the `sofra.md` overlay. No `--no-verify`, no bypasses.
- **Tests** (DEV-PHASES-PLAN W1): `npm run test` = Vitest unit suite over the pure `lib/` modules (format, mollie amount, validation schemas, rate-limit, tenant-registry — no DB/network; Mollie is never called). `npm run test:e2e` = Playwright login smoke (admin→/admin, partner→/dashboard, partner-blocked-from-/admin) against a seeded throwaway DB (`scripts/seed-e2e.mjs`). `scripts/e2e-local.mjs` (the no-browser progressive-enhancement walk of the partner program; needs a **clean** local DB — leftover LIVE client collides on `tenantSlug`) + the QA test accounts remain for manual/full-flow checks.

## §8 — Git workflow

- Branch off `main`, PR to `main` (`feature/` `fix/` `chore/` `docs/`). Commits: `type(scope): description`.
- **Merge ≠ deploy.** A merge builds the image; rollout is manual on the staging box: `docker compose -f docker-compose.prod.yml pull sofra && up -d sofra` (in `/opt/rumi/deploy`, via `deploy/.ssh/staging.sh`). **Schema changes: run the migrate one-off BEFORE rolling the app.**
- PR body uses `.github/pull_request_template.md` — including the NFR triage section (DEV-PHASES-PLAN P1).

## §9 — AI guardrails (refusal list)

- **Never exercise billing actions against the live key** (create plan/checkout from `/admin/billing`, re-POST webhooks with real `tr_` ids) unless the owner explicitly asks — real money moves. Billing QA = local dev with `MOLLIE_API_KEY_TEST`.
- **Never edit an applied migration**, `prisma/migrations/*` history, or run destructive SQL against the box DB without explicit instruction.
- **Never commit** `.env`, `.env.local`, or any key material; `.env.example` gets placeholders only.
- **Box operations** (env edits, rollouts, one-offs) go through the `operating-rumi-infra` skill patterns — never improvise SSH commands against the boxes.
- **Auth.js config** (`lib/auth.ts` rate limits, dummy-hash, JWT callbacks) and `lib/rbac.ts` are security-load-bearing — change only with explicit instruction + security-review skill.
- Post-merge bot comments (Gemini, SonarCloud) get triaged with rationale on the PR — applied or declined, never ignored.
