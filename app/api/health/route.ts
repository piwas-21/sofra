import { NextResponse } from "next/server";

/**
 * Liveness + **build identity**.
 *
 * The build identity is the reason this exists. Without it there is no way to tell a
 * current deployment from a months-old one: every other check — pages render, login works,
 * env vars are wired — passes just as happily against a stale image, so a deployed-staging
 * test suite could report a clean bill of health for an environment nobody had rolled since
 * the change under test was written. `version` closes that hole; it is baked at image build
 * time from the commit SHA (Dockerfile `ARG BUILD_SHA`, supplied by build-image.yml).
 *
 * **Deliberately unauthenticated.** It is the Docker HEALTHCHECK target and a monitoring
 * endpoint, so it must answer before anything else works. That is safe only because it
 * touches nothing: no database, no session, no request body, no env beyond the two public
 * build stamps. Do not add anything here that reads user data or config — the guard rule in
 * CLAUDE.md §5.1 covers `(control)` surfaces precisely because they do.
 *
 * **Deliberately dependency-free.** `status: "ok"` means *this process is serving HTTP* and
 * nothing more — it does NOT mean the database is reachable. Liveness and readiness are
 * separate on purpose: pinging Postgres from an unauthenticated public endpoint makes a
 * cheap request expensive, which is a DoS lever, and it would take the container down on a
 * blip that the app itself recovers from. Whether the DB is healthy is already proven by
 * anything that signs in.
 */

// Never prerendered or cached: the point is to report what THIS running container is, and a
// static answer captured at build time would survive an env override on the box.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      // Distinguishes this app from the tenant backend, which answers its own health probe
      // with `service: "restaurant-system-api"` — a monitor pointed at the wrong host by a
      // DNS or Caddy mistake would otherwise see a healthy 200 and report all clear.
      service: "sofra-control-plane",
      version: process.env.BUILD_SHA || "unknown",
      builtAt: process.env.BUILD_TIME || "unknown",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
