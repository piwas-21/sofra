import { afterEach, describe, expect, it } from "vitest";
import {
  JOB_LEASE_MINUTES,
  MAX_PENDING_JOBS_PER_BOX,
  backupCreateVerdict,
  backupDeleteEnabled,
  backupDeleteVerdict,
  jobIsClaimable,
} from "@/lib/backup-job-policy";

const NOW = new Date("2026-08-21T09:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

afterEach(() => {
  delete process.env.BACKUP_DELETE_ENABLED;
});

describe("backupDeleteEnabled", () => {
  it("is OFF unless the value is exactly the string true", () => {
    // The default is what ships everywhere. Deleting a backup destroys the only
    // copy of a departed customer's data and there is no undo.
    expect(backupDeleteEnabled()).toBe(false);
    for (const v of ["", "false", "1", "yes", "TRUE", "true "]) {
      process.env.BACKUP_DELETE_ENABLED = v;
      expect(backupDeleteEnabled()).toBe(false);
    }
    process.env.BACKUP_DELETE_ENABLED = "true";
    expect(backupDeleteEnabled()).toBe(true);
  });
});

describe("backupDeleteVerdict", () => {
  const ok = {
    enabled: true,
    artifact: { tenantSlug: "obresse" },
    tenantArtifactCount: 4,
    typedSlug: "obresse",
    reason: "customer confirmed erasure request",
    override: false,
  };

  it("permits a well-formed deletion of a non-last copy", () => {
    expect(backupDeleteVerdict(ok)).toEqual({ ok: true });
  });

  it("refuses first on the environment flag, before revealing anything else", () => {
    // A disabled deployment must not become an oracle for which artifacts exist:
    // the flag is checked before the artifact, the slug and the reason.
    expect(backupDeleteVerdict({ ...ok, enabled: false, artifact: null })).toEqual({
      ok: false,
      reason: "deleteDisabled",
    });
  });

  it("refuses an unknown artifact", () => {
    expect(backupDeleteVerdict({ ...ok, artifact: null })).toEqual({
      ok: false,
      reason: "artifactNotFound",
    });
  });

  it("refuses a slug typed for a DIFFERENT tenant", () => {
    expect(backupDeleteVerdict({ ...ok, typedSlug: "rumi" })).toEqual({
      ok: false,
      reason: "confirmSlugMismatch",
    });
  });

  it("is case-sensitive but tolerates surrounding whitespace", () => {
    // Slugs are lowercase by grammar, so a case difference means a different
    // thing was typed; a trailing space is a paste artefact, not a mistake.
    expect(backupDeleteVerdict({ ...ok, typedSlug: " obresse " })).toEqual({ ok: true });
    expect(backupDeleteVerdict({ ...ok, typedSlug: "Obresse" })).toEqual({
      ok: false,
      reason: "confirmSlugMismatch",
    });
  });

  it("refuses a reason that does not say anything", () => {
    for (const reason of ["", "   ", "cleanup", "        "]) {
      expect(backupDeleteVerdict({ ...ok, reason })).toEqual({
        ok: false,
        reason: "reasonRequired",
      });
    }
  });

  it("refuses to destroy a tenant's LAST copy without an explicit override", () => {
    expect(backupDeleteVerdict({ ...ok, tenantArtifactCount: 1 })).toEqual({
      ok: false,
      reason: "lastArtifact",
    });
  });

  it("allows the last copy once the override is given", () => {
    expect(backupDeleteVerdict({ ...ok, tenantArtifactCount: 1, override: true })).toEqual({
      ok: true,
    });
  });

  it("refuses a miscounted ZERO too — the safe direction is to refuse", () => {
    expect(backupDeleteVerdict({ ...ok, tenantArtifactCount: 0 })).toEqual({
      ok: false,
      reason: "lastArtifact",
    });
  });
});

describe("backupCreateVerdict", () => {
  it("permits — an extra copy of data we already hold cannot lose anything", () => {
    expect(backupCreateVerdict({ knownTenant: true, pendingForBox: 0 })).toEqual({ ok: true });
  });

  it("refuses a tenant the registry does not know", () => {
    expect(backupCreateVerdict({ knownTenant: false, pendingForBox: 0 })).toEqual({
      ok: false,
      reason: "unknownTenant",
    });
  });

  it("caps queued work per box, to protect the BOX rather than the data", () => {
    expect(
      backupCreateVerdict({ knownTenant: true, pendingForBox: MAX_PENDING_JOBS_PER_BOX - 1 }),
    ).toEqual({ ok: true });
    expect(
      backupCreateVerdict({ knownTenant: true, pendingForBox: MAX_PENDING_JOBS_PER_BOX }),
    ).toEqual({ ok: false, reason: "tooManyPending" });
  });
});

describe("jobIsClaimable (the lease)", () => {
  it("hands out pending work", () => {
    expect(jobIsClaimable({ status: "PENDING", claimedAt: null }, NOW)).toBe(true);
  });

  it("does not re-offer a job a box is still working on", () => {
    expect(
      jobIsClaimable({ status: "CLAIMED", claimedAt: minutesAgo(JOB_LEASE_MINUTES - 1) }, NOW),
    ).toBe(false);
  });

  it("re-offers a job whose box died mid-run", () => {
    expect(
      jobIsClaimable({ status: "CLAIMED", claimedAt: minutesAgo(JOB_LEASE_MINUTES) }, NOW),
    ).toBe(true);
  });

  it("treats a CLAIMED row with no timestamp as expired rather than stranded", () => {
    expect(jobIsClaimable({ status: "CLAIMED", claimedAt: null }, NOW)).toBe(true);
  });

  it("never re-offers finished work", () => {
    expect(jobIsClaimable({ status: "DONE", claimedAt: minutesAgo(600) }, NOW)).toBe(false);
    expect(jobIsClaimable({ status: "FAILED", claimedAt: minutesAgo(600) }, NOW)).toBe(false);
  });
});
