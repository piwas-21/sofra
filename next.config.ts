import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

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
  "connect-src 'self'",
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

export default withNextIntl(nextConfig);
