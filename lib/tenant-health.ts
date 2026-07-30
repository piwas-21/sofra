// Does a tenant's app actually answer? The single piece of EVIDENCE behind the
// owner dashboard's "your app is ready" claim (SOFRA-ONBOARDING-PLAN O4).
//
// Split from `tenant-liveness.ts` because this half touches the network: the pure
// classifier belongs in the coverage floor, this does not (CLAUDE.md §7 — modules with
// network branches stay out of scope rather than acquire mocks).

import { unstable_cache } from "next/cache";
import { tenantOrigin } from "@/lib/tenant-liveness";

/**
 * The `/api/health` payload's own name for itself (backend Program.cs). Asserted on
 * because **a bare 200 proves nothing here** — the same lesson O5 learned from a bare
 * 404. A wildcard-caught subdomain, a Caddy default page, a parked domain and the
 * marketing site all answer 200 to a host that has no tenant behind it, and any of
 * them would promote a tenant that does not exist yet to "ready".
 */
const HEALTH_SERVICE_ID = "restaurant-system-api";

/** How long a tenant's health answer is reused. Provisioning takes ~15 min, so an
 *  owner refreshing twice in a minute does not need two round-trips to a box. */
const HEALTH_TTL_SECONDS = 60;

/** Budget for the probe — a dashboard render must not hang on an unreachable box. */
const HEALTH_TIMEOUT_MS = 3000;

async function fetchHealth(domain: string): Promise<boolean> {
  const origin = tenantOrigin(domain);
  if (!origin) return false;
  try {
    const res = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { service?: unknown }).service === HEALTH_SERVICE_ID
    );
  } catch {
    // FAILS CLOSED — the opposite of the tenant frontend's getTenantModules, and the
    // difference is worth stating because the two look alike. There, a network blip
    // must not take features away from a working app, so unknown means "everything".
    // Here, unknown means "we have not seen it serve", and the only thing riding on it
    // is a claim we make to a paying customer plus a link we tell them to click. Never
    // promote uncertainty to ready.
    return false;
  }
}

/**
 * Has this tenant's app answered? Cached per domain for {@link HEALTH_TTL_SECONDS}.
 *
 * `unstable_cache` rather than `fetch`'s own `next.revalidate` because the request
 * carries an `AbortSignal`, which opts a fetch out of Next's data cache entirely — the
 * timeout and the cache cannot both live on the same call.
 */
export const probeTenantHealthy = unstable_cache(fetchHealth, ["tenant-health"], {
  revalidate: HEALTH_TTL_SECONDS,
  tags: ["tenant-health"],
});
