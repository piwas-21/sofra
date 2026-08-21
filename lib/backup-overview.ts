// The page, as data. Registry + artifacts + plans + box reports -> one sorted
// list of rows, and a headline.
//
// Pure, and that is the whole reason it exists as a module: the judgement
// "this restaurant's data is not protected" is the product here, and it must be
// unit-testable without a database, a session or a clock. /admin/backups renders
// what this returns and decides nothing itself.

import {
  backupHealth,
  isClusterDumpOnly,
  rowNeedsAttention,
  rowSeverity,
  totalBytes,
  type BackupHealth,
} from "@/lib/backup-health";
import { backupRetentionView, type BackupRetentionView } from "@/lib/backup-retention";
import { offBoxMissing } from "@/lib/backup-offbox";
import { buildBoxRows, quietBoxMap, type BackupBoxRow, type BoxFact } from "@/lib/backup-boxes";

// Re-exported so the page, the components and the alarm keep one import for the
// whole shape of this feature's data.
export type { BackupBoxRow, BoxFact };

export type ArtifactFact = {
  tenantSlug: string;
  box: string;
  /** Prisma enum values, uppercase. */
  location: "RESTIC" | "LOCAL";
  takenAt: Date;
  sizeBytes: bigint;
};

export type RegistryFact = {
  slug: string;
  name: string;
  status: string;
  box: string;
  /** The registry's `managed:` — `scripts` for a provisioned tenant, `legacy` for
   *  tenant 1 (ADR-006). Load-bearing rather than descriptive: the box's own
   *  `bk_registry_tenants` skips `legacy`, so a legacy tenant NEVER gains a
   *  per-tenant artifact and any age rule applied to it is answering a question
   *  nobody asked. Its data rides the whole-cluster dump instead. */
  managed: string;
};

export type PlanFact = { tenantSlug: string; trialEndsAt: Date | null; paying: boolean };

export type BackupTenantRow = {
  slug: string;
  /** From the registry. Null for a tenant we hold data for but no longer list —
   *  which is not an error state, it is the departed customer this feature is
   *  for. */
  name: string | null;
  registryStatus: string | null;
  /** The registry's `managed:`, or null for a tenant with no entry. `legacy`
   *  means no per-tenant artifact will ever exist — see RegistryFact. */
  managed: string | null;
  box: string | null;
  artifactCount: number;
  offBoxCount: number;
  newestTakenAt: Date | null;
  bytes: number;
  health: BackupHealth;
  /** True when this tenant is never dumped on its own and rides the whole-cluster
   *  dump instead (`managed: legacy`, ADR-006). Then `health` is answering a
   *  question that does not apply to it, and both the page and the alarm say so
   *  by staying quiet about the per-tenant view — see `isClusterDumpOnly`. */
  clusterDumpOnly: boolean;
  /** Dumped, and not leaving the box — see `backup-offbox.ts`. Not a health
   *  verdict: these copies may be perfectly fresh, and gone with the box. */
  offBoxMissing: boolean;
  /** True when the box this tenant's artifacts came from has stopped reporting,
   *  so every age on this row is a memory rather than an observation. */
  boxQuiet: boolean;
  retention: BackupRetentionView;
};

export type BackupOverview = {
  rows: BackupTenantRow[];
  boxes: BackupBoxRow[];
  /** Rows that are anything other than `protected`. The headline number. */
  attention: number;
  quietBoxes: number;
};

function groupBySlug(artifacts: readonly ArtifactFact[]): Map<string, ArtifactFact[]> {
  const bySlug = new Map<string, ArtifactFact[]>();
  for (const a of artifacts) {
    const list = bySlug.get(a.tenantSlug) ?? [];
    list.push(a);
    bySlug.set(a.tenantSlug, list);
  }
  return bySlug;
}

/**
 * Which box a row belongs to.
 *
 * The registry's `box:` when the tenant still has an entry — that is the
 * authoritative answer and it is right even when we hold no artifacts at all,
 * which is exactly the `never` case that most needs a box named. Otherwise the
 * box the newest artifact came from, because for a departed tenant that is the
 * only remaining evidence of where its data lives.
 */
function boxFor(registry: RegistryFact | undefined, artifacts: readonly ArtifactFact[]): string | null {
  if (registry) return registry.box;
  return artifacts[0]?.box ?? null;
}

/**
 * Build every row the page shows.
 *
 * The union of "tenants the registry knows" and "slugs we hold artifacts for" —
 * both directions matter and each catches something the other cannot. A registry
 * tenant with no artifacts is the silent provisioning gap (VISIBLE here rather
 * than absent, which is the difference between noticing and not). An artifact
 * with no registry entry is a departed customer whose data we still hold, and
 * whose retention date is the answer to "do you still have our menu?".
 */
export function buildBackupOverview(input: {
  registry: readonly RegistryFact[];
  artifacts: readonly ArtifactFact[];
  plans: readonly PlanFact[];
  boxReports: readonly BoxFact[];
  now: Date;
  retentionDays: number;
}): BackupOverview {
  const bySlug = groupBySlug(input.artifacts);
  const registryBySlug = new Map(input.registry.map((r) => [r.slug, r]));
  const planBySlug = new Map(input.plans.map((p) => [p.tenantSlug, p]));

  const quietByBox = quietBoxMap(input.boxReports, input.now);
  const boxes = buildBoxRows(input.boxReports, input.artifacts, quietByBox);

  const slugs = new Set<string>([...registryBySlug.keys(), ...bySlug.keys()]);

  const rows = [...slugs].map<BackupTenantRow>((slug) => {
    const artifacts = (bySlug.get(slug) ?? [])
      .slice()
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
    const registry = registryBySlug.get(slug);
    const plan = planBySlug.get(slug);
    const offBox = artifacts.filter((a) => a.location === "RESTIC");
    const facts = {
      artifactCount: artifacts.length,
      newestTakenAt: artifacts[0]?.takenAt ?? null,
      offBoxCount: offBox.length,
      // Sorted newest-first above, so [0] is newest and the last is oldest.
      newestOffBoxTakenAt: offBox[0]?.takenAt ?? null,
      oldestTakenAt: artifacts.at(-1)?.takenAt ?? null,
    };
    const box = boxFor(registry, artifacts);
    return {
      slug,
      name: registry?.name ?? null,
      registryStatus: registry?.status ?? null,
      managed: registry?.managed ?? null,
      box,
      artifactCount: facts.artifactCount,
      offBoxCount: facts.offBoxCount,
      newestTakenAt: facts.newestTakenAt,
      bytes: totalBytes(artifacts.map((a) => a.sizeBytes)),
      health: backupHealth(facts, input.now),
      clusterDumpOnly: isClusterDumpOnly(registry?.managed),
      offBoxMissing: offBoxMissing(facts, input.now),
      boxQuiet: box !== null && (quietByBox.get(box) ?? true),
      retention: backupRetentionView(
        {
          registryStatus: registry?.status ?? null,
          trialEndsAt: plan?.trialEndsAt ?? null,
          paying: plan?.paying ?? false,
          newestTakenAt: facts.newestTakenAt,
        },
        input.now,
        input.retentionDays,
      ),
    };
  });

  // Worst first, then alphabetical. A backup page sorted by name is a page whose
  // one urgent row is wherever the alphabet put it.
  //
  // A cluster-dump-only tenant sorts as calm whatever its age says — see
  // `rowSeverity`.
  rows.sort((a, b) => rowSeverity(b) - rowSeverity(a) || a.slug.localeCompare(b.slug));

  return {
    rows,
    boxes,
    attention: rows.filter(rowNeedsAttention).length,
    quietBoxes: boxes.filter((b) => b.quiet).length,
  };
}
