// Sentry — server (Node runtime) init. Loaded by instrumentation.ts.
// DSN comes from env; when unset the SDK is a no-op, so this is INERT until
// SENTRY_DSN is set on the box. See .env.example + deploy repo for wiring.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Error tracking only for now — tracing off (cost/noise). Raise later.
  tracesSampleRate: 0,
  // Never let the SDK print PII-y request bodies into our logs (§8 no-PII).
  sendDefaultPii: false,
});
