#!/usr/bin/env bash
# Run the full Playwright E2E suite locally against a THROWAWAY Postgres.
#
#   bash scripts/e2e-suite.sh                 # everything the env supports
#   bash scripts/e2e-suite.sh self-serve      # one spec (substring match)
#
# Nothing is mocked: a real production build, a real database, the real auth
# stack, the real tenant registry (tests/e2e/fixtures/registry.yml) and — when a
# test_ Mollie key is available — the real Mollie API.
#
# Billing (CLAUDE.md §9): this refuses to run against a `live_` key. It reads
# MOLLIE_API_KEY_TEST from .env; without it the billing specs SKIP loudly rather
# than pass quietly, and the rest of the suite still runs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONTAINER=sofra-e2e-pg
PORT=${E2E_PORT:-3210}
DB_PORT=${E2E_DB_PORT:-55440}

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── secrets: test Mollie key only, never the live one ───────────────────────
# An explicitly-set MOLLIE_API_KEY_TEST wins over .env, including when set EMPTY:
# `MOLLIE_API_KEY_TEST= bash scripts/e2e-suite.sh` is how you run the suite
# without touching Mollie at all (and how the skip path itself gets tested).
# Without this, sourcing .env would silently put the key back.
PRESET_MOLLIE="${MOLLIE_API_KEY_TEST-__unset__}"
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && . ./.env && set +a
fi
if [[ "$PRESET_MOLLIE" != "__unset__" ]]; then
  MOLLIE_API_KEY_TEST="$PRESET_MOLLIE"
fi
MOLLIE_KEY="${MOLLIE_API_KEY_TEST:-}"
if [[ -n "$MOLLIE_KEY" && "$MOLLIE_KEY" != test_* ]]; then
  echo "refusing to run: MOLLIE_API_KEY_TEST is not a test_ key" >&2
  exit 1
fi
if [[ -z "$MOLLIE_KEY" ]]; then
  echo "note: no MOLLIE_API_KEY_TEST — the billing specs will skip" >&2
fi

echo "→ throwaway postgres on :$DB_PORT"
cleanup
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=sofra -p "$DB_PORT:5432" \
  postgres:16-alpine >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

export DATABASE_URL="postgresql://postgres:e2e@localhost:$DB_PORT/sofra"
AUTH_SECRET="$(openssl rand -hex 24)"; export AUTH_SECRET
export AUTH_TRUST_HOST=true
export NEXTAUTH_URL="http://localhost:$PORT"
export NEXT_PUBLIC_SITE_URL="http://localhost:$PORT"
export E2E_BASE_URL="http://localhost:$PORT"
# `next start` reads PORT; without this it listens on 3000 while Playwright waits
# on $PORT and the webServer times out with no useful message.
export PORT="$PORT"
export E2E_ADMIN_EMAIL="e2e-admin@example.test"
export E2E_PARTNER_EMAIL="e2e-partner@example.test"
E2E_ADMIN_PASSWORD="$(openssl rand -hex 12)"; export E2E_ADMIN_PASSWORD
E2E_PARTNER_PASSWORD="$(openssl rand -hex 12)"; export E2E_PARTNER_PASSWORD
# The suite's own registry, not the sibling deploy repo: `taken` needs a
# known-occupied slug, and an ABSENT registry is not neutral — since O2 an
# unreadable one makes the signup fail closed.
export TENANT_REGISTRY_PATH="$PWD/tests/e2e/fixtures/registry.yml"

# Seller identity for invoicing (SOFRA-BILLING-IDENTITY-PLAN B4). FIXTURE VALUES,
# deliberately not the real company's — the plan requires that a test environment
# never issue a document carrying the real identity.
#
# Without these, sellerIdentity() returns null and issueInvoiceForPayment
# short-circuits on `sellerNotConfigured` BEFORE opening its transaction. That is
# the correct production behaviour until the owner supplies the real values, but
# in the suite it meant the advisory-lock allocator, the MAX(seq) read, the JSON
# snapshot write and tx.invoice.create had ZERO executed coverage while the run
# reported green — a gate failing open in the most deceptive way, because the
# short-circuit is the expected state and nobody would read the pass as suspicious.
export SOFRA_LEGAL_NAME="E2E Fixture BV"
export SOFRA_LEGAL_ADDRESS="1 Fixture Street"
export SOFRA_LEGAL_POSTAL="1000AA"
export SOFRA_LEGAL_CITY="Amsterdam"
export SOFRA_LEGAL_COUNTRY="NL"
# Required since the imprint shipped — sellerIdentityGaps() lists it, so without
# it the seller is "not configured" and EVERY invoice short-circuits before the
# transaction. That is how it broke: the var became required in a later PR and
# nothing re-read this fixture, so the suite went green while issuing nothing.
export SOFRA_LEGAL_EMAIL="e2e@example.test"
export SOFRA_KVK="00000000"
export SOFRA_VAT_NUMBER="NL000000000B01"
export SOFRA_INVOICE_SERIES="E2E"
# A placeholder: the provisioning specs only observe the payment gate, which
# refuses BEFORE the GitHub round-trip. When the gate passes a request, the call
# fails on this value — and that failure is the proof it passed.
export PROVISION_GITHUB_TOKEN="ghp_e2e_placeholder_never_valid_0000000000"
export MOLLIE_API_KEY="$MOLLIE_KEY"
# `next start` loads .env.local too, so a developer's real Resend key would be
# picked up and the suite would fire a live API call per signup — sending test
# addresses to a third party and making the run depend on their uptime. Blanking
# it here wins (process env beats .env files) and makes sendEmail log instead.
export RESEND_API_KEY=""
# Same reason: a developer's Sentry DSN in .env.local would be baked into the
# build below and send every deliberate E2E error to a real project.
export SENTRY_DSN=""
export NEXT_PUBLIC_SENTRY_DSN=""
export WAITLIST_TO="e2e-founder@example.test"
# Mollie validates webhook reachability at payment creation and 422s a localhost
# URL, so real payments could not be created from here at all without this. The
# suite POSTs the real payment id to the local handler itself; only the delivery
# hop is stood in for. See lib/billing.ts webhookUrl().
export MOLLIE_WEBHOOK_URL="https://example.com/sofra-e2e-webhook-sink"

echo "→ migrate + seed"
# `--no-install` on every npx below: plain `npx` will silently FETCH a missing
# package and run its lifecycle scripts, so a typo'd or hijacked name becomes code
# execution in a shell that holds a Mollie key. These binaries are devDependencies
# and must already be installed; refuse rather than reach for the network.
npx --no-install prisma migrate deploy >/dev/null
node scripts/seed-e2e.mjs

echo "→ build (without DATABASE_URL in scope — repo rule)"
DATABASE_URL="" npm run build >/dev/null

echo "→ playwright"
npx --no-install playwright test ${1:+"$1"}
