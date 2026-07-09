// Next.js instrumentation hook — loads the Sentry runtime configs at server
// startup and forwards nested Server Component / route errors to Sentry.
// Native Next 15 feature; no-op when no SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
