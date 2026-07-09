// Sentry — browser init. Uses the PUBLIC DSN, which is baked into the client
// bundle at BUILD time, so browser error capture only activates when
// NEXT_PUBLIC_SENTRY_DSN was set at build. The CSP `connect-src` must then
// include the ingest origin (derived from the DSN in next.config.ts).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  // No Session Replay — keeps the bundle small and avoids extra CSP/worker-src.
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
