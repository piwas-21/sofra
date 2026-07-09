"use client";

// Root error boundary — the ONLY place that catches errors thrown by the root
// layout itself. It replaces the whole document (own <html>/<body>), so it runs
// without providers or the global stylesheet; keep the fallback dependency-free
// and inline-styled (no craft tokens available here). Reports to Sentry (no-op
// when no DSN is configured).
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            fontFamily: "system-ui, sans-serif",
            maxWidth: "32rem",
            margin: "4rem auto",
            padding: "0 1.5rem",
            textAlign: "center",
          }}
        >
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please reload the page.</p>
        </main>
      </body>
    </html>
  );
}
