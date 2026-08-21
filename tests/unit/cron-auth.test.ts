import { afterEach, describe, expect, it } from "vitest";
import { bearerAuthorized, cronAuthorized } from "@/lib/cron-auth";

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

describe("bearerAuthorized (the same check against any shared secret)", () => {
  // The generic form the backup-agent endpoints use (BACKUP_AGENT_SECRET). It is
  // the SAME code path cronAuthorized delegates to — which is the point of
  // extracting it: an auth comparison that exists in three copies is one where
  // the fix to a timing property reaches one of them.
  const backupReq = (authorization?: string) =>
    new Request("https://sofrapiwas.com/api/telemetry/backups", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    });

  it("accepts the exact bearer token for the secret it is handed", () => {
    expect(bearerAuthorized(backupReq("Bearer agent-secret"), "agent-secret")).toBe(true);
  });

  it("refuses when the secret is undefined or empty — no secret, no access", () => {
    expect(bearerAuthorized(backupReq("Bearer "), undefined)).toBe(false);
    expect(bearerAuthorized(backupReq("Bearer "), "")).toBe(false);
    expect(bearerAuthorized(backupReq(), undefined)).toBe(false);
  });

  it("refuses a wrong token, a missing header and the bare secret", () => {
    expect(bearerAuthorized(backupReq("Bearer wrong"), "agent-secret")).toBe(false);
    expect(bearerAuthorized(backupReq(), "agent-secret")).toBe(false);
    expect(bearerAuthorized(backupReq("agent-secret"), "agent-secret")).toBe(false);
  });

  it("does not leak one caller's secret to another endpoint's guard", () => {
    // Callers pass the secret rather than a name, so nothing here can read an
    // environment variable the caller did not intend.
    process.env.CRON_SECRET = "cron-secret";
    expect(bearerAuthorized(backupReq("Bearer cron-secret"), "agent-secret")).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    expect(() => bearerAuthorized(backupReq("Bearer " + "x".repeat(4096)), "s")).not.toThrow();
  });
});
