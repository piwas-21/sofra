// In-memory fixed-window rate limiter. Fine for a single container (which is
// exactly our deploy shape); swap for Redis if sofra ever scales horizontally.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  if (buckets.size > 10_000) {
    // Prune expired entries so a scan/spray can't grow the map unbounded.
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  return bucket.count <= max;
}

export function clientIp(request: Request): string {
  // Caddy sets X-Forwarded-For; take the first (client) hop.
  const xff = request.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown";
}
