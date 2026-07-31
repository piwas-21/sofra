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
 * **Deliberately unauthenticated**, like every other route under `app/api/` (§5.1's guard
 * rule covers `(control)` surfaces, which this is not). That is safe only because it touches
 * nothing: no database, no session, no request body, no env beyond the two build stamps. Do
 * not add anything here that reads user data or config — `tests/e2e/health.spec.ts` pins the
 * payload to exactly these four keys so that stays true.
 *
 * **On publishing the commit SHA.** This repo is PUBLIC and its images are anonymously
 * pullable from GHCR (`ghcr.io/piwas-21/sofra:latest` answers without credentials), so the
 * source and the exact lockfile of any published build are already readable by anyone. What
 * this adds is only *which* published build is live right now. The residual is real and
 * worth naming: with a public repo and manual rollouts (CLAUDE.md §8), the pair
 * `version` + `builtAt` is a patch-gap oracle — a caller can tell whether the live billing
 * app has been rolled to a merged security fix yet, and poll until it has. Dropping
 * `builtAt` would not close that; the SHA alone dates itself against the public history.
 * Closing it means either a private repo or not publishing identity at all, which is a
 * posture decision rather than a code one.
 *
 * **No rate limit**, unlike the sibling intake routes. Those meter because they write, send
 * mail and cost money per call; this allocates one small object and touches no I/O. A
 * limiter here would also be actively harmful: it would let request volume from anywhere
 * turn a liveness probe into a 429 and report a perfectly healthy container as down.
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
