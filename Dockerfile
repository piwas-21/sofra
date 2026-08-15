# Same three-stage pattern as restaurant-app-frontend.
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts (Sonar S6505): no dependency lifecycle script runs during
# the install. ONE is then run back, explicitly and by name: on musl,
# @prisma/engines only gets its schema-engine binary from its postinstall, and
# without it the `migrate` stage below dies at runtime with "Can't write to
# /app/node_modules/@prisma/engines" (measured on the built image, both ways).
# Only that stage needs it: `prisma generate` and the running app do not — the
# runtime talks to Postgres through @prisma/adapter-pg, no engine binary.
# The `ls` is not decoration: `npm rebuild <gone-package>` exits 0, so a future
# Prisma rename would otherwise build green here and only fail on the box
# during a release.
RUN npm ci --ignore-scripts \
    && npm rebuild @prisma/engines \
    && ls node_modules/@prisma/engines/schema-engine-* \
    && npm cache clean --force

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# One-off DB tooling for the box (which deploys images only — no repo, no
# npm in the runtime image). Full deps tree, so the prisma CLI and the seed
# script's imports (pg, bcryptjs) all resolve; linux-musl binaries because
# npm ci ran in the deps stage. Published as ghcr.io/piwas-21/sofra:migrate.
#   migrate: docker run --rm --network <net> -e DATABASE_URL=… <img>
#   seed:    docker run --rm --network <net> -e DATABASE_URL=… -e ADMIN_EMAIL=… \
#              -e ADMIN_NAME=… -e ADMIN_PASSWORD=… <img> node scripts/seed-admin.mjs
FROM node:22-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/seed-admin.mjs ./scripts/seed-admin.mjs
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Drop the bundled npm CLI — runtime is `node server.js`; npm's transitive
# deps only feed Trivy HIGH/CRITICAL noise (same rationale as the frontend).
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Healthcheck probe is never imported by the app, so output-file-tracing
# doesn't bundle it — copy explicitly (same gotcha as the frontend image).
COPY --from=builder --chown=nextjs:nodejs /app/healthcheck.js ./healthcheck.js

# NOTE: DB migrations/seed do NOT live in this image — they run from the
# sibling `migrate` target (published as ghcr.io/piwas-21/sofra:migrate),
# keeping this runtime image slim. See DEPLOYMENT.md for the one-off commands.

# Build identity, surfaced by /api/health. Read at request time, not compiled into the
# bundle, so they can be overridden on the box if an image is ever re-tagged by hand.
# Without them a deployed environment cannot be told apart from a months-old one — every
# other health signal passes either way.
#
# Placed HERE, below every COPY, because BUILD_TIME changes on every single build: any
# layer after it is rebuilt every time. Above the COPYs it would defeat `cache-from: gha`
# for the whole runner stage — the npm removal, the user creation and all three COPYs.
ARG BUILD_SHA=unknown
ARG BUILD_TIME=unknown
ENV BUILD_SHA=${BUILD_SHA}
ENV BUILD_TIME=${BUILD_TIME}

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "healthcheck.js"]

CMD ["node", "server.js"]
