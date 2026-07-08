import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bucketCount, clientIp, rateLimit } from "@/lib/rate-limit";

// The limiter keeps a module-level Map keyed by the caller-supplied key.
// Tests isolate themselves by using a unique key per case (plus fake timers
// for the window-expiry case) rather than resetting module state.

describe("rateLimit (in-memory fixed window)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls up to and including max, then blocks", () => {
    const key = "test-basic";
    expect(rateLimit(key, 3, 1000)).toBe(true); // 1
    expect(rateLimit(key, 3, 1000)).toBe(true); // 2
    expect(rateLimit(key, 3, 1000)).toBe(true); // 3 (== max)
    expect(rateLimit(key, 3, 1000)).toBe(false); // 4 (over)
  });

  it("resets the window after windowMs elapses", () => {
    const key = "test-window";
    expect(rateLimit(key, 1, 1000)).toBe(true);
    expect(rateLimit(key, 1, 1000)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rateLimit(key, 1, 1000)).toBe(true); // fresh window
  });

  it("keeps distinct keys isolated", () => {
    expect(rateLimit("iso-a", 1, 1000)).toBe(true);
    expect(rateLimit("iso-a", 1, 1000)).toBe(false);
    expect(rateLimit("iso-b", 1, 1000)).toBe(true); // b unaffected by a
  });

  it("prunes expired buckets under a unique-key spray so the map stays bounded", () => {
    // Spray >10k unique keys in a short window — each one takes the new-key
    // fast path. This is the actual DoS vector (random IPs), so the prune must
    // NOT be gated behind the existing-key branch.
    for (let i = 0; i < 10_050; i++) rateLimit(`spray-${i}`, 5, 1000);
    const flooded = bucketCount();
    expect(flooded).toBeGreaterThan(10_000);

    // Let the spray age out, then make one more call to a brand-new key. The
    // prune has to fire on THIS call (new-key path) to sweep the expired spray;
    // if it only ran on the existing-key path (the bug), the map would stay
    // flooded. Regression guard: fails on the pre-fix code, passes on the fix.
    vi.advanceTimersByTime(2000);
    rateLimit("after-spray", 5, 1000);
    expect(bucketCount()).toBeLessThan(flooded - 10_000);
  });
});

describe("clientIp (X-Forwarded-For parsing)", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test", { headers });

  it("takes the LAST (Caddy-appended, trustworthy) hop from a multi-hop XFF", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" }))).toBe("10.0.0.2");
  });

  it("ignores a client-spoofed leading hop and uses the real appended IP (#30)", () => {
    // Attacker sends `X-Forwarded-For: 1.2.3.4`; Caddy appends the real client
    // IP on the right. Keying on the last hop makes the spoof a no-op.
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("trims whitespace around the last hop", () => {
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.1,  198.51.100.4  " }))).toBe("198.51.100.4");
  });

  it("returns the sole hop for a single-value header", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to 'unknown' when the header is absent", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("falls back to 'unknown' for an empty header", () => {
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBe("unknown");
  });
});
