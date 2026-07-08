import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retentionConfig, retentionCutoffs } from "@/lib/retention-policy";

describe("retentionConfig (env parsing)", () => {
  const KEYS = [
    "RETENTION_ENABLED",
    "RETENTION_INVITE_TOKEN_DAYS",
    "RETENTION_AUDIT_LOG_MONTHS",
    "RETENTION_REJECTED_APPLICATION_MONTHS",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to disabled with the privacy-pack windows", () => {
    expect(retentionConfig()).toEqual({
      enabled: false,
      inviteTokenDays: 30,
      auditLogMonths: 18,
      rejectedApplicationMonths: 12,
    });
  });

  it("enables only for the exact string 'true' (never truthy-ish values)", () => {
    process.env.RETENTION_ENABLED = "TRUE";
    expect(retentionConfig().enabled).toBe(false);
    process.env.RETENTION_ENABLED = "1";
    expect(retentionConfig().enabled).toBe(false);
    process.env.RETENTION_ENABLED = "true";
    expect(retentionConfig().enabled).toBe(true);
  });

  it("honors positive-integer window overrides", () => {
    process.env.RETENTION_INVITE_TOKEN_DAYS = "7";
    process.env.RETENTION_AUDIT_LOG_MONTHS = "24";
    process.env.RETENTION_REJECTED_APPLICATION_MONTHS = "6";
    expect(retentionConfig()).toMatchObject({
      inviteTokenDays: 7,
      auditLogMonths: 24,
      rejectedApplicationMonths: 6,
    });
  });

  it("falls back to defaults for zero, negative, non-integer, or garbage overrides", () => {
    process.env.RETENTION_INVITE_TOKEN_DAYS = "0";
    process.env.RETENTION_AUDIT_LOG_MONTHS = "-3";
    process.env.RETENTION_REJECTED_APPLICATION_MONTHS = "1.5";
    expect(retentionConfig()).toMatchObject({
      inviteTokenDays: 30,
      auditLogMonths: 18,
      rejectedApplicationMonths: 12,
    });
    process.env.RETENTION_INVITE_TOKEN_DAYS = "abc";
    expect(retentionConfig().inviteTokenDays).toBe(30);
  });
});

describe("retentionCutoffs (date math)", () => {
  const cfg = { enabled: true, inviteTokenDays: 30, auditLogMonths: 18, rejectedApplicationMonths: 12 };

  it("subtracts days and months from now", () => {
    const now = new Date("2026-07-08T12:00:00.000Z");
    const c = retentionCutoffs(now, cfg);
    expect(c.inviteTokenBefore.toISOString()).toBe("2026-06-08T12:00:00.000Z"); // −30 days
    expect(c.rejectedApplicationBefore.toISOString()).toBe("2025-07-08T12:00:00.000Z"); // −12 months
    expect(c.auditLogBefore.toISOString()).toBe("2025-01-08T12:00:00.000Z"); // −18 months
  });

  it("clamps a month-end rollover to the last day of the intended month", () => {
    const now = new Date("2026-03-31T00:00:00.000Z");
    const c = retentionCutoffs(now, { ...cfg, auditLogMonths: 1 });
    // Mar 31 − 1mo would overflow to Mar 3; the clamp pins it to Feb 28 (2026
    // is not a leap year) so nothing younger than the window is purged.
    expect(c.auditLogBefore.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});
