import { expect, test } from "./helpers/fixtures";

/**
 * `/api/health` against the LOCAL production build.
 *
 * Deliberately separate from the deployed-staging suite. That one asks "is the thing on the
 * box current?" and needs a real deployment to answer; this one asks "does the endpoint work
 * at all?", which is a property of the code and belongs in CI — where it runs on every PR,
 * including the ones that would break it. Without this, the route's only coverage would be a
 * suite that runs against an environment somebody has to remember to roll first.
 *
 * It also guards the Docker HEALTHCHECK, which now probes this path: break the route and
 * every container goes unhealthy on its next check, which is a much worse way to find out.
 *
 * No credentials, no database, no seeded state — it must pass on a bare build.
 */
test.describe("/api/health", () => {
  test("reports liveness and identifies the service", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    // The name is load-bearing, not decoration: it is how a probe pointed at the wrong host
    // tells "healthy" from "healthy, but this is the tenant backend".
    expect(body.service).toBe("sofra-control-plane");

    // Present even in a build where the Dockerfile ARGs never ran — the endpoint must report
    // `unknown` rather than omit the field, because a consumer checking currency needs to
    // tell "no identity baked" from "no such key".
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("builtAt");
  });

  test("is never cached", async ({ request }) => {
    // A cached health response is a lie with a timestamp on it: the whole point is to report
    // what THIS container is right now, and an intermediary serving a stored copy would keep
    // answering for a container that had already gone.
    const res = await request.get("/api/health");
    expect(res.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("leaks no configuration", async ({ request }) => {
    // Unauthenticated by necessity (Docker HEALTHCHECK, external monitors), so the payload is
    // pinned to exactly four public keys. This fails the moment someone "helpfully" adds a
    // database status, an env dump or a Mollie mode to it.
    const body = (await (await request.get("/api/health")).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["builtAt", "service", "status", "version"]);
  });
});
