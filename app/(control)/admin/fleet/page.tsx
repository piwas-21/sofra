import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { loadTenantRegistry, type RegistryTenant } from "@/lib/tenant-registry";

// The registry file changes underneath us (rsync on deploy-repo push) — always re-read.
export const dynamic = "force-dynamic";

// Presentation-layer liveness thresholds (the backend stores raw facts; "online"/"stale" is derived
// here, per the fleet plan). A device heartbeats ~every 60s and the backend rolls up every few min.
const ONLINE_WINDOW_MS = 5 * 60 * 1000; // no heartbeat in 5 min ⇒ offline
const STALE_FEED_MS = 5 * 60 * 1000; // feed "running" but no successful poll in 5 min ⇒ wedged

type Translator = (key: string, values?: Record<string, string | number>) => string;

type FleetDeviceRow = {
  deviceId: string;
  label: string | null;
  platform: string | null;
  appVersion: string | null;
  feedRunning: boolean;
  lastHeartbeatAt: Date | null;
  lastSuccessfulPollAt: Date | null;
};

type FleetSummaryRow = { missedOrders: number; recentErrors: number };

function livenessLabel(device: FleetDeviceRow, now: number, t: Translator): { label: string; online: boolean } {
  const online = device.lastHeartbeatAt != null && now - device.lastHeartbeatAt.getTime() < ONLINE_WINDOW_MS;
  if (online) return { label: t("device.online"), online };
  if (device.lastHeartbeatAt == null) return { label: t("device.neverSeen"), online };
  const minutes = Math.max(0, Math.round((now - device.lastHeartbeatAt.getTime()) / 60000));
  return { label: t("device.offlineSince", { minutes }), online };
}

function feedStatus(device: FleetDeviceRow, now: number, t: Translator): { label: string; ok: boolean } {
  const stale =
    device.feedRunning &&
    (device.lastSuccessfulPollAt == null || now - device.lastSuccessfulPollAt.getTime() > STALE_FEED_MS);
  if (!device.feedRunning) return { label: t("device.feedStopped"), ok: false };
  if (stale) return { label: t("device.feedStale"), ok: false };
  return { label: t("device.feedRunning"), ok: true };
}

function DeviceRow({ device, now, t }: Readonly<{ device: FleetDeviceRow; now: number; t: Translator }>) {
  const liveness = livenessLabel(device, now, t);
  const feed = feedStatus(device, now, t);
  const feedTone = feed.ok
    ? "text-craft-success-text dark:text-craft-success"
    : "text-craft-error-text dark:text-craft-error";

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <span>
        <span className="font-label font-bold">{device.label ?? device.deviceId.slice(0, 8)}</span>
        <span className="ml-2 font-label text-sm text-muted-foreground">
          {device.platform ?? "—"} · v{device.appVersion ?? "—"}
        </span>
      </span>
      <span className="font-label text-sm text-right">
        <span className={liveness.online ? "text-craft-success-text dark:text-craft-success" : "text-muted-foreground"}>
          {liveness.label}
        </span>
        <span className={`ml-3 ${feedTone}`}>{feed.label}</span>
      </span>
    </li>
  );
}

function TenantCard({
  tenant,
  devices,
  summary,
  now,
  t,
}: Readonly<{
  tenant: RegistryTenant;
  devices: FleetDeviceRow[];
  summary?: FleetSummaryRow;
  now: number;
  t: Translator;
}>) {
  return (
    <li className="hand-drawn-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span>
          <span className="font-hand text-2xl font-bold">{tenant.slug}</span>
          <span className="ml-3 font-label text-sm text-muted-foreground">
            {tenant.name}
            {tenant.city ? ` · ${tenant.city}` : ""}
          </span>
        </span>
        {summary && (
          <span className="font-label text-sm text-right text-muted-foreground">
            {t("summary.missed", { count: summary.missedOrders })} ·{" "}
            {t("summary.errors", { count: summary.recentErrors })}
          </span>
        )}
      </div>

      {devices.length === 0 ? (
        <p className="mt-3 font-label text-sm text-muted-foreground">{t("tenant.noReport")}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {devices.map((d) => (
            <DeviceRow key={d.deviceId} device={d} now={now} t={t} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FleetHeader({ t }: Readonly<{ t: Translator }>) {
  return (
    <div>
      <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
      <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
    </div>
  );
}

export default async function AdminFleetPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.fleet" });
  const registry = await loadTenantRegistry();

  // Registry unavailable ⇒ bail before the DB reads (nothing to join to).
  if (!registry.ok) {
    return (
      <div className="grid gap-10">
        <FleetHeader t={t} />
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("unavailable", { error: registry.error })}
        </p>
      </div>
    );
  }

  // Scope the reads to the tenants we'll actually render (the registry), so orphaned/decommissioned
  // rows don't get loaded as the fleet grows (Gemini review on #71).
  const tenantSlugs = registry.tenants.map((t) => t.slug);
  const [devices, summaries] = await Promise.all([
    db.fleetDevice.findMany({
      where: { tenantSlug: { in: tenantSlugs } },
      orderBy: [{ tenantSlug: "asc" }, { label: "asc" }],
    }),
    db.fleetSummary.findMany({ where: { tenantSlug: { in: tenantSlugs } } }),
  ]);

  const devicesBySlug = new Map<string, FleetDeviceRow[]>();
  for (const d of devices) {
    const list = devicesBySlug.get(d.tenantSlug) ?? [];
    list.push(d);
    devicesBySlug.set(d.tenantSlug, list);
  }
  const summaryBySlug = new Map(summaries.map((s) => [s.tenantSlug, s]));
  const now = Date.now();

  return (
    <div className="grid gap-10">
      <FleetHeader t={t} />
      <section>
        <h2 className="font-hand text-3xl font-bold">
          {t("registered", { count: registry.tenants.length })}
        </h2>
        <ul className="mt-4 grid gap-4">
          {registry.tenants.map((tenant) => (
            <TenantCard
              key={tenant.slug}
              tenant={tenant}
              devices={devicesBySlug.get(tenant.slug) ?? []}
              summary={summaryBySlug.get(tenant.slug)}
              now={now}
              t={t}
            />
          ))}
          {registry.tenants.length === 0 && (
            <li className="font-label text-muted-foreground">{t("empty")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
