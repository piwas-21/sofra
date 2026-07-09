import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin();

// The browser Sentry SDK POSTs events to its ingest host; derive that origin
// from the public DSN so the CSP `connect-src` can allow exactly it — and only
// when Sentry is configured, keeping the CSP tight when it is off. Runs at build
// time (next.config), same moment NEXT_PUBLIC_SENTRY_DSN is baked into the bundle.
function sentryIngestOrigin(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}
const sentryConnectSrc = sentryIngestOrigin();

// Security headers (DEV-PHASES-PLAN W0 — closes the "live SaaS without headers"
// hole; approach mirrors the RUMI frontend's next.config.ts, tightened to what
// this app actually loads: fonts are self-hosted via next/font, there are no
// external scripts/styles/images/connections, JSON-LD + the theme-init snippet
// are the only inline scripts.
//
// - `script-src 'unsafe-inline'`: required by Next.js App Router streaming
//   (self.__next_f.push) + the theme-init snippet. 'unsafe-eval' is dev-only
//   (React Refresh needs it; production must not carry it).
// - `frame-ancestors 'none'` (+ X-Frame-Options DENY): nothing embeds sofra.
// - HSTS without `preload`: preload is a hard-to-reverse, list-submission
//   decision for the whole apex (incl. every *.sofrapiwas.com tenant) — owner
//   call, not a default.
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${sentryConnectSrc ? ` ${sentryConnectSrc}` : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // upgrade-insecure-requests also fires on http://localhost (browsers upgrade
  // the RSC fetches → SSL errors), so keep it out of dev. Local `next start`
  // over http still carries it — expect exactly that error class there.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  // Standalone output for the Docker image (same pattern as the RUMI frontend).
  output: "standalone",

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// Sentry wraps the config last: it wires the client SDK into the bundle and the
// server SDK via instrumentation.ts. Source-map upload is disabled (no auth
// token wired), so the build stays green offline and in CI; add org/project/
// authToken later to get readable stack traces. `enabled` on each Sentry.init
// keeps the whole thing inert until a DSN is set.
export default withSentryConfig(withNextIntl(nextConfig), {
  silent: !process.env.CI,
  sourcemaps: { disable: true },
});
