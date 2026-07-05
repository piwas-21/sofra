# Same three-stage pattern as restaurant-app-frontend.
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

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
# npm ci ran in the deps stage. Published as ghcr.io/piwas-21/sofra-migrate.
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
# sibling `migrate` target (published as ghcr.io/piwas-21/sofra-migrate),
# keeping this runtime image slim. See DEPLOYMENT.md for the one-off commands.

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "healthcheck.js"]

CMD ["node", "server.js"]
