import { describe, expect, it } from "vitest";
import { buildBackupOverview, type ArtifactFact } from "@/lib/backup-overview";
import { alertSignature, buildBackupAlert, expectsNightly } from "@/lib/backup-alert-policy";
import {
  REMINDER_HOURS,
  decideBackupAlert,
  type BackupAlertMarker,
} from "@/lib/backup-alert-cadence";

// The alarm. Two failures are worth more than every other assertion here: it
// stays silent while a restaurant is unprotected, or it repeats itself until the
// reader filters it away. Both are tested directly.
//
// Rows are built through the REAL `buildBackupOverview` rather than hand-made, so
// a change to the health rules cannot leave this suite green against a shape the
// page no longer produces.

const NOW = new Date("2026-08-21T09:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

const artifact = (over: Partial<ArtifactFact> & { tenantSlug: string }): ArtifactFact => ({
  box: "staging",
  location: "RESTIC",
  takenAt: hoursAgo(6),
  sizeBytes: 1024n,
  ...over,
});

const registry = (slug: string, over: Partial<{ status: string; box: string; managed: string }> = {}) => ({
  slug,
  name: `${slug} Restaurant`,
  status: "active",
  box: "staging",
  managed: "scripts",
  ...over,
});

const reportingBox = [{ box: "staging", reportedAt: hoursAgo(1), receivedAt: hoursAgo(1) }];

function alertFor(input: {
  registry?: ReturnType<typeof registry>[];
  artifacts?: ArtifactFact[];
  boxReports?: { box: string; reportedAt: Date; receivedAt: Date }[];
}) {
  const overview = buildBackupOverview({
    registry: input.registry ?? [],
    artifacts: input.artifacts ?? [],
    plans: [],
    boxReports: input.boxReports ?? reportingBox,
    now: NOW,
    retentionDays: 180,
  });
  return buildBackupAlert({ rows: overview.rows, boxes: overview.boxes, now: NOW });
}

describe("buildBackupAlert — what is worth an email", () => {
  it("says nothing when every watched tenant has a recent off-box copy", () => {
    const alert = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi" })],
    });
    expect(alert).toMatchObject({ level: "none", concerns: [], watched: 1 });
  });

  it("is CRITICAL for a tenant the registry knows and we hold nothing for", () => {
    // The provisioning gap: it survives every green nightly run, because a run
    // that was never asked to dump this tenant does not fail.
    const alert = alertFor({ registry: [registry("obresse")] });
    expect(alert.level).toBe("critical");
    expect(alert.concerns).toHaveLength(1);
    expect(alert.concerns[0]).toMatchObject({ slug: "obresse", health: "never", ageHours: null });
  });

  it("is CRITICAL past 72h and only amber between 36h and 72h", () => {
    const amber = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi", takenAt: hoursAgo(40) })],
    });
    expect(amber.level).toBe("warn");
    expect(amber.concerns[0]).toMatchObject({ health: "stale", ageHours: 40 });

    const red = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi", takenAt: hoursAgo(80) })],
    });
    expect(red.level).toBe("critical");
    expect(red.concerns[0]).toMatchObject({ health: "unprotected", ageHours: 80 });
  });

  it("does NOT raise a tenant whose local copies simply have not shipped YET", () => {
    // The false alarm that got this trigger removed on the first production run,
    // and the one the re-armed rule must still not raise: fresh copies, no
    // off-box twin, and tonight's ship has not run.
    const alert = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi", location: "LOCAL" })],
    });
    expect(alert.level).toBe("none");
    expect(alert.concerns).toHaveLength(0);
  });

  it("RAISES a tenant that is dumped nightly and whose dumps never leave the box", () => {
    // Re-armed 2026-08-21, once the agent could actually see a restic snapshot
    // (deploy #139). Amber, not red: the data exists and is fresh — it is one
    // box failure from gone, which is a different sentence to "it is aging out".
    const alert = alertFor({
      registry: [registry("obresse")],
      artifacts: [
        artifact({ tenantSlug: "obresse", location: "LOCAL", takenAt: hoursAgo(4) }),
        artifact({ tenantSlug: "obresse", location: "LOCAL", takenAt: hoursAgo(40) }),
      ],
    });
    expect(alert.level).toBe("warn");
    expect(alert.concerns[0]).toMatchObject({
      slug: "obresse",
      health: "protected",
      offBoxMissing: true,
    });
    // And it is visible in the signature, so the day a copy finally ships the
    // reader is told the situation CHANGED rather than left with an old mail.
    expect(alert.signature).toBe("warn|obresse:protected+offbox");
  });

  it("stays silent about the LEGACY tenant, which is never dumped per-tenant", () => {
    // Also measured in production: the first run alerted `rumi: never`, and the box
    // was right — `bk_registry_tenants` skips `managed: legacy`, whose database rides
    // the whole-cluster dump. An age rule there is permanently, unfixably red.
    const alert = alertFor({ registry: [registry("rumi", { managed: "legacy" })] });
    expect(alert).toMatchObject({ level: "none", watched: 0 });
    // …while an ordinary tenant in the same state is still alerted.
    expect(alertFor({ registry: [registry("obresse")] }).level).toBe("critical");
  });

  it("stays SILENT about a departed tenant whose copies are an archive", () => {
    // No registry entry: its nightly stopped on purpose and its retention date is
    // the page's job. Alerting would produce a red mail nobody can ever act on.
    const alert = alertFor({ artifacts: [artifact({ tenantSlug: "gone", takenAt: hoursAgo(400) })] });
    expect(alert).toMatchObject({ level: "none", watched: 0 });
  });

  it("stays silent about a retired or still-provisioning entry", () => {
    const alert = alertFor({
      registry: [registry("old", { status: "retired" }), registry("new", { status: "provisioning" })],
    });
    expect(alert).toMatchObject({ level: "none", watched: 0 });
  });

  it("WATCHES an unknown status — a registry typo must not silence the alarm", () => {
    const alert = alertFor({ registry: [registry("odd", { status: "actve" })] });
    expect(expectsNightly({ registryStatus: "actve", managed: "scripts" } as never)).toBe(true);
    expect(alert.level).toBe("critical");
  });

  it("watches a tenant whose free period lapsed — it is still serving lunch", () => {
    const overview = buildBackupOverview({
      registry: [registry("obresse")],
      artifacts: [artifact({ tenantSlug: "obresse", takenAt: hoursAgo(80) })],
      plans: [{ tenantSlug: "obresse", trialEndsAt: hoursAgo(48), paying: false }],
      boxReports: reportingBox,
      now: NOW,
      retentionDays: 180,
    });
    // The retention view calls this an archive candidate; the alarm does not,
    // because the registry still runs it.
    expect(overview.rows[0].retention.kind).toBe("retained");
    const alert = buildBackupAlert({ rows: overview.rows, boxes: overview.boxes, now: NOW });
    expect(alert).toMatchObject({ level: "critical", watched: 1 });
  });

  it("is CRITICAL when a box has gone quiet, even with nothing else wrong", () => {
    const alert = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi" })],
      boxReports: [{ box: "staging", reportedAt: hoursAgo(9), receivedAt: hoursAgo(9) }],
    });
    expect(alert).toMatchObject({ level: "critical", quietBoxes: ["staging"] });
    // The tenant's own age is now a memory, and the concern says so.
    expect(alert.concerns).toHaveLength(0);
  });

  it("names quiet boxes in a stable order, so an unchanged alarm stays unchanged", () => {
    const quiet = (box: string) => ({ box, reportedAt: hoursAgo(9), receivedAt: hoursAgo(9) });
    const alert = alertFor({ boxReports: [quiet("staging"), quiet("prod")] });
    // Sorted with an explicit comparator: the names are part of the signature, so a
    // reordering would read as a changed situation and re-send the same news.
    expect(alert.quietBoxes).toEqual(["prod", "staging"]);
    expect(alert.signature).toContain("quiet:prod|quiet:staging");
  });

  it("is CRITICAL when no box has ever reported — the agent may not exist", () => {
    const alert = alertFor({ boxReports: [] });
    expect(alert).toMatchObject({ level: "critical", noBoxHasEverReported: true });
  });

  it("signs WHAT is wrong and not how long it has been wrong", () => {
    const at40 = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi", takenAt: hoursAgo(40) })],
    });
    const at50 = alertFor({
      registry: [registry("rumi")],
      artifacts: [artifact({ tenantSlug: "rumi", takenAt: hoursAgo(50) })],
    });
    // Same verdict, older evidence — the same news, so the same signature.
    expect(at40.signature).toBe(at50.signature);
    expect(at40.signature).toBe("warn|rumi:stale");
    expect(alertSignature({ ...at40, quietBoxes: ["prod"], noBoxHasEverReported: true })).toBe(
      "warn|rumi:stale|quiet:prod|noBoxHasEverReported",
    );
  });
});

describe("decideBackupAlert — say it, repeat it, or stay quiet", () => {
  const marker = (over: Partial<BackupAlertMarker> = {}): BackupAlertMarker => ({
    level: "critical",
    signature: "critical|rumi:unprotected",
    at: hoursAgo(1),
    ...over,
  });
  const decide = (
    alert: { level: "none" | "warn" | "critical"; signature: string },
    last: BackupAlertMarker | null,
  ) => decideBackupAlert({ alert, last, now: NOW });

  it("sends the first time a problem appears", () => {
    expect(decide({ level: "critical", signature: "x" }, null)).toEqual({
      send: true,
      kind: "raised",
      reason: "new",
    });
  });

  it("stays quiet on a repeat of the same unchanged problem", () => {
    expect(decide({ level: "critical", signature: marker().signature }, marker())).toEqual({
      send: false,
      reason: "unchanged",
    });
  });

  it("speaks again when the situation CHANGES", () => {
    const changed = { level: "critical" as const, signature: "critical|rumi:unprotected|demo:never" };
    expect(decide(changed, marker())).toMatchObject({ send: true, reason: "changed" });
  });

  it("re-nags a red situation daily and an amber one every three days", () => {
    const red = { level: "critical" as const, signature: marker().signature };
    expect(decide(red, marker({ at: hoursAgo(REMINDER_HOURS.critical - 1) }))).toMatchObject({
      send: false,
    });
    expect(decide(red, marker({ at: hoursAgo(REMINDER_HOURS.critical) }))).toMatchObject({
      send: true,
      reason: "reminder",
    });

    const amber = { level: "warn" as const, signature: "warn|rumi:stale" };
    const amberMarker = (h: number) => marker({ level: "warn", signature: amber.signature, at: hoursAgo(h) });
    expect(decide(amber, amberMarker(REMINDER_HOURS.warn - 1))).toMatchObject({ send: false });
    expect(decide(amber, amberMarker(REMINDER_HOURS.warn))).toMatchObject({ send: true });
  });

  it("closes its own loop exactly once when everything recovers", () => {
    const healthy = { level: "none" as const, signature: "none" };
    expect(decide(healthy, marker())).toEqual({ send: true, kind: "cleared", reason: "recovered" });
    // …and then goes quiet: the all-clear is itself the last thing said.
    const cleared = marker({ level: "none", signature: "none" });
    expect(decide(healthy, cleared)).toEqual({ send: false, reason: "healthy" });
  });

  it("never opens with an all-clear on a platform that was never alerted", () => {
    expect(decide({ level: "none", signature: "none" }, null)).toEqual({
      send: false,
      reason: "healthy",
    });
  });

  it("treats a problem after an all-clear as NEW, not as a continuation", () => {
    const cleared = marker({ level: "none", signature: "none", at: hoursAgo(2) });
    expect(decide({ level: "warn", signature: "warn|rumi:stale" }, cleared)).toMatchObject({
      reason: "new",
    });
  });
});
