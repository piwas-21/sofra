#!/usr/bin/env bash
# Keep findings separate from fetch failures; the parser fails closed on either.
set -euo pipefail
report=$(mktemp)
trap 'rm -f "$report"' EXIT
status=0
npm audit --json > "$report" || status=$?
if [[ "$status" -gt 1 ]]; then
  echo "npm audit failed before producing a verdict" >&2
  exit "$status"
fi
node scripts/check-npm-audit.mjs < "$report"
