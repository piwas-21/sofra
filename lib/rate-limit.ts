// In-memory fixed-window rate limiter. Fine for a single container (which is
// exactly our deploy shape); swap for Redis if sofra ever scales horizontally.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Self-defense bounds against a sustained unique-key spray (#31). The prune is an
// O(n) scan; a fresh spray leaves nothing to evict, so without these guards the
// scan would run on EVERY call (work quadratic in sprayed requests) AND the map
// would still grow unbounded (memory-exhaustion DoS). Two guards bound both costs:
// a throttled prune (cpu) and a hard ceiling (mem), across three knobs —
//   PRUNE_SOFT_CAP    — don't scan until the map has actually grown.
//   PRUNE_INTERVAL_MS — then scan at most this often, never once-per-request (cpu).
//   HARD_CAP          — refuse to track NEW keys past this ceiling, fail closed (mem).
const PRUNE_SOFT_CAP = 10_000;
const PRUNE_INTERVAL_MS = 1_000;
const HARD_CAP = 20_000;
let lastPruneAt = 0;

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  // Throttled prune, BEFORE the new-key fast path: past the soft cap, sweep
  // expired entries at most once per PRUNE_INTERVAL_MS — never once-per-request,
  // so the defense can't itself become an O(n)-per-call (quadratic) cost under a
  // sustained spray. It lives here, not in the `!bucket` branch, because a spray
  // of random keys returns early there — gating the prune on that branch would
  // skip it exactly under the attack it defends against.
  // `lastPruneAt === 0` (never pruned yet, or a test clock pinned at epoch 0) and
  // `now < lastPruneAt` (clock stepped backwards, e.g. an NTP correction) both force
  // a prune rather than strand the sweep — otherwise a backward jump would disable
  // pruning until the clock caught back up to lastPruneAt.
  if (
    buckets.size > PRUNE_SOFT_CAP &&
    (lastPruneAt === 0 || now < lastPruneAt || now - lastPruneAt >= PRUNE_INTERVAL_MS)
  ) {
    lastPruneAt = now;
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // Hard ceiling: when the throttled prune can't keep up (a fresh spray has
    // nothing expired to evict), stop tracking NEW keys rather than grow without
    // bound. Fail closed — an untracked key over the ceiling counts as
    // rate-limited. Keys already tracked (incl. this one resetting an expired
    // window, which doesn't grow the map) are never evicted here.
    if (!bucket && buckets.size >= HARD_CAP) return false;
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/** Number of tracked buckets — memory observability + prune regression tests. */
export function bucketCount(): number {
  return buckets.size;
}

/**
 * Test-only reset of the module-level state (bucket map + prune-throttle clock).
 * Unique per-test keys isolate the map, but the throttle clock (#31) is shared
 * module state that keys can't isolate — tests call this to stay deterministic.
 */
export function __resetForTests(): void {
  buckets.clear();
  lastPruneAt = 0;
}

// Caddy APPENDS the connecting client's IP as the LAST X-Forwarded-For hop, so
// the trustworthy address is the rightmost token. The leftmost is client-
// supplied and spoofable — reading it (as the old code did) let an attacker
// rotate the first hop per request to bypass every IP-keyed rate limit (#30).
// Single known proxy today; if a second trusted proxy is ever fronted, switch to
// Caddy `trusted_proxies` + rightmost-untrusted instead of a fixed last-hop.
export function clientIpFromXff(xff: string | null | undefined): string {
  return xff?.split(",").pop()?.trim() || "unknown";
}

export function clientIp(request: Request): string {
  return clientIpFromXff(request.headers.get("x-forwarded-for"));
}
