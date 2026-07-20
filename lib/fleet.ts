import { z } from "zod";
import { db } from "@/lib/db";

// Payload pushed by a tenant backend's FleetSummaryPushService (one-directional, bearer-authed).
// Non-PII only: device roster + counts, never customer data / API keys / raw orders.
export const fleetDeviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  label: z.string().trim().max(120).nullish(),
  platform: z.string().trim().max(40).nullish(),
  appVersion: z.string().trim().max(40).nullish(),
  feedRunning: z.boolean().default(false),
  lastHeartbeatAt: z.coerce.date().nullish(),
  lastSuccessfulPollAt: z.coerce.date().nullish(),
  apiBaseUrl: z.string().trim().max(300).nullish(),
  kitchenPrinter: z.string().trim().max(200).nullish(),
  cashierPrinter: z.string().trim().max(200).nullish(),
});

export const fleetPushSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(80),
  reportedAt: z.coerce.date(),
  missedOrders: z.number().int().min(0).max(1_000_000).default(0),
  recentErrors: z.number().int().min(0).max(1_000_000).default(0),
  devices: z.array(fleetDeviceSchema).max(200),
});

export type FleetPush = z.infer<typeof fleetPushSchema>;
type FleetDeviceInput = z.infer<typeof fleetDeviceSchema>;

function deviceColumns(d: FleetDeviceInput) {
  return {
    label: d.label ?? null,
    platform: d.platform ?? null,
    appVersion: d.appVersion ?? null,
    feedRunning: d.feedRunning,
    lastHeartbeatAt: d.lastHeartbeatAt ?? null,
    lastSuccessfulPollAt: d.lastSuccessfulPollAt ?? null,
    apiBaseUrl: d.apiBaseUrl ?? null,
    kitchenPrinter: d.kitchenPrinter ?? null,
    cashierPrinter: d.cashierPrinter ?? null,
  };
}

// Upsert the tenant's summary + reconcile its device roster (upsert reported, prune the rest) in
// one transaction, so a partial failure can't leave a half-updated fleet view.
export async function ingestFleetPush(push: FleetPush): Promise<void> {
  const slug = push.tenantSlug;
  const now = new Date();
  // Dedup by deviceId (a repeated id in one push would upsert the same row twice) and sort
  // deterministically, so concurrent same-tenant pushes acquire row locks in the same order and
  // can't deadlock. A later duplicate wins (Map keeps the last value for a key).
  const devices = Array.from(new Map(push.devices.map((d) => [d.deviceId, d])).values()).sort((a, b) =>
    a.deviceId.localeCompare(b.deviceId),
  );
  const reportedIds = devices.map((d) => d.deviceId);

  await db.$transaction(async (tx) => {
    await tx.fleetSummary.upsert({
      where: { tenantSlug: slug },
      create: {
        tenantSlug: slug,
        deviceCount: devices.length,
        missedOrders: push.missedOrders,
        recentErrors: push.recentErrors,
        reportedAt: push.reportedAt,
        receivedAt: now,
      },
      update: {
        deviceCount: devices.length,
        missedOrders: push.missedOrders,
        recentErrors: push.recentErrors,
        reportedAt: push.reportedAt,
        receivedAt: now,
      },
    });

    // Prune devices this tenant no longer reports (decommissioned) — scoped to THIS tenant only.
    // An empty roster drops them all; otherwise keep only the reported ids.
    if (reportedIds.length === 0) {
      await tx.fleetDevice.deleteMany({ where: { tenantSlug: slug } });
    } else {
      await tx.fleetDevice.deleteMany({ where: { tenantSlug: slug, deviceId: { notIn: reportedIds } } });
    }

    for (const d of devices) {
      const columns = deviceColumns(d);
      await tx.fleetDevice.upsert({
        where: { tenantSlug_deviceId: { tenantSlug: slug, deviceId: d.deviceId } },
        create: { tenantSlug: slug, deviceId: d.deviceId, ...columns },
        update: columns,
      });
    }
  });
}
