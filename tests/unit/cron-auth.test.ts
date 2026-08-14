import { afterEach, describe, expect, it } from "vitest";
import { cronAuthorized } from "@/lib/cron-auth";

const req = (authorization?: string) =>
  new Request("https://sofrapiwas.com/api/cron/retention", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("cronAuthorized", () => {
  it("accepts the exact bearer token", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(cronAuthorized(req("Bearer s3cret-value"))).toBe(true);
  });

  it("refuses when CRON_SECRET is unset — no secret, no access", () => {
    // Guards the endpoints against an environment where the var was never set:
    // an empty expected value must never match an empty provided one.
    expect(cronAuthorized(req("Bearer "))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });

  it("refuses a wrong token", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(cronAuthorized(req("Bearer wrong"))).toBe(false);
  });

  it("refuses a missing Authorization header", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(cronAuthorized(req())).toBe(false);
  });

  it("refuses the bare secret without the Bearer scheme", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(cronAuthorized(req("s3cret-value"))).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    // The reason both sides are hashed to a fixed 32 bytes first: timingSafeEqual
    // throws on differing lengths, which would 500 instead of 401 and leak the
    // secret's length via the error.
    process.env.CRON_SECRET = "short";
    expect(() => cronAuthorized(req("Bearer " + "x".repeat(4096)))).not.toThrow();
    expect(cronAuthorized(req("Bearer " + "x".repeat(4096)))).toBe(false);
  });
});
