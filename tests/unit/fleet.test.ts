import { describe, expect, it } from "vitest";
import { fleetPushSchema } from "@/lib/fleet";

describe("fleetPushSchema (backend → sofra roll-up)", () => {
  const valid = {
    tenantSlug: "rumi",
    reportedAt: "2026-07-20T10:00:00.000Z",
    missedOrders: 1,
    recentErrors: 2,
    devices: [
      {
        deviceId: "dev-abc",
        label: "Kitchen tablet",
        platform: "Android",
        appVersion: "1.0.20",
        feedRunning: true,
        lastHeartbeatAt: "2026-07-20T10:00:00.000Z",
        lastSuccessfulPollAt: "2026-07-20T09:59:00.000Z",
        apiBaseUrl: "https://www.rumirestaurant.ch",
        kitchenPrinter: "192.168.1.50",
        cashierPrinter: "192.168.1.51",
      },
    ],
  };

  it("accepts a well-formed push and coerces ISO dates", () => {
    const parsed = fleetPushSchema.parse(valid);
    expect(parsed.tenantSlug).toBe("rumi");
    expect(parsed.reportedAt).toBeInstanceOf(Date);
    expect(parsed.devices[0].lastHeartbeatAt).toBeInstanceOf(Date);
    expect(parsed.devices[0].feedRunning).toBe(true);
  });

  it("defaults counts and feedRunning, allows an empty roster", () => {
    const parsed = fleetPushSchema.parse({
      tenantSlug: "rumi",
      reportedAt: valid.reportedAt,
      devices: [{ deviceId: "dev-1" }],
    });
    expect(parsed.missedOrders).toBe(0);
    expect(parsed.recentErrors).toBe(0);
    expect(parsed.devices[0].feedRunning).toBe(false);

    const empty = fleetPushSchema.parse({ tenantSlug: "rumi", reportedAt: valid.reportedAt, devices: [] });
    expect(empty.devices).toHaveLength(0);
  });

  it("rejects a missing tenant slug, missing device id, and negative counts", () => {
    expect(fleetPushSchema.safeParse({ ...valid, tenantSlug: "" }).success).toBe(false);
    expect(fleetPushSchema.safeParse({ ...valid, missedOrders: -1 }).success).toBe(false);
    expect(
      fleetPushSchema.safeParse({ ...valid, devices: [{ deviceId: "" }] }).success,
    ).toBe(false);
  });

  it("rejects an over-long device id (guards the DB column)", () => {
    const parsed = fleetPushSchema.safeParse({
      ...valid,
      devices: [{ deviceId: "x".repeat(65) }],
    });
    expect(parsed.success).toBe(false);
  });
});
