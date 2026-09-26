#!/usr/bin/env sh
set -eu

if [ -z "${CATALOGUE_DATABASE_URL:-}" ]; then
  echo "CATALOGUE_DATABASE_URL is required for catalogue migrations" >&2
  exit 2
fi

exec node node_modules/prisma/build/index.js migrate deploy --config prisma.catalogue.config.ts
