// In-memory fixed-window rate limiter. Fine for a single container (which is
// exactly our deploy shape); swap for Redis if sofra ever scales horizontally.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  // Bound the map BEFORE the new-key fast path: prune expired entries whenever
  // it grows past the cap, on EVERY call. A unique-key spray (random IPs) only
  // ever hits the `!bucket` branch below and returns early — if the prune lived
  // there it would be skipped exactly under the attack it defends against,
  // letting the map grow unbounded (memory-exhaustion DoS). Expired entries are
  // all that can be evicted, so a short window self-limits as keys age out.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
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

export function clientIp(request: Request): string {
  // Caddy sets X-Forwarded-For; take the first (client) hop.
  const xff = request.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown";
}
