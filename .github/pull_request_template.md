<!--
  PR template — Sofra (sofrapiwas.com: LIVE marketing site + control plane).
  See CLAUDE.md §6 (pre-implementation verification) and §8 (git workflow).
  Delete sections that don't apply.
-->

## Summary
<!-- 1–3 bullets: what and why. -->
- ...

## Issue / plan link
- Closes #
- Plan: <!-- workspace SOFRA-SAAS-PLAN phase / ADR # / ROADMAP row -->

## Type
- [ ] `feat` · [ ] `fix` · [ ] `refactor` · [ ] `chore` · [ ] `docs` · [ ] `test` · [ ] `perf`

## NFR triage (DEV-PHASES-PLAN P1 — one line per touched dimension, "rest: n/a because …")
<!--
  D1 security · D2 performance · D3 cpu/mem · D4 UX · D5 a11y · D6 i18n ·
  D7 privacy/PII · D8 observability · D9 testing · D10 conventions.
  Auth/payment/PII/new-endpoint changes: add 3–5 threat-model-lite bullets under D1.
-->
- D…:
- Rest: n/a because …

## Control-plane security (delete if no `(control)` surface touched)
- [ ] Every new/changed page, server action, and route handler calls `requireAdmin()` / `requirePartner()` first
- [ ] No PII (emails, names, phones, Mollie ids) added to logs
- [ ] Webhook-adjacent code stays fetch-and-verify (never trusts the POSTed body)

## Database / migrations (delete if no schema change)
- [ ] Migration is handwritten SQL in `prisma/migrations/<ts>_<name>/` (no edits to applied migrations)
- [ ] Deploy notes below include the box migrate one-off step (BEFORE app rollout)
- [ ] `prisma_drift` CI job green

## i18n parity (delete if no marketing-string change)
- Keys added/changed: `…`
- [ ] en · [ ] fr · [ ] de · [ ] nl · [ ] tr · [ ] ar (RTL layout still works)
- (control plane is en-only by design — no checklist for it)

## Standard checklist
- [ ] `npm run typecheck` · `npm run lint` · `npm run build` all green locally
- [ ] Craft tokens only (no ad-hoc hex); dark mode via `.dark` class
- [ ] Money handled as EUR integer cents
- [ ] No secrets/keys in the diff
- [ ] Branch off `main`, PR to `main`

## Test plan
<!-- e2e-local.mjs run? Manual steps with the QA test accounts (docs/runbooks/sofra-test-accounts.md)?
     NEVER exercise billing against the live key — local + MOLLIE_API_KEY_TEST only. -->
- [ ] ...

## Deploy notes
<!-- Merge ≠ deploy: rollout is manual (staging box: compose pull sofra && up -d sofra). -->
- Migration one-off required: no / yes (command)
- New env vars on the box: none / list
- Rollout order / risk:
