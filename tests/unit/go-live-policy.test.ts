import { describe, expect, it } from "vitest";
import { goLiveDecision, type GoLiveFacts } from "@/lib/go-live-policy";

/** A live, never-announced tenant with a usable address — the one case that sends. */
const CUTOFF = new Date("2026-08-14T00:00:00Z");

const base = (over: Partial<GoLiveFacts> = {}): GoLiveFacts => ({
  stage: "ready",
  firstPaidAt: new Date("2026-08-20T10:00:00Z"),
  announceFrom: CUTOFF,
  partnerManaged: false,
  alreadyAnnounced: false,
  to: "owner@example.com",
  origin: "https://chez-amara.sofrapiwas.com",
  ...over,
});

describe("goLiveDecision — announcing", () => {
  it("announces a tenant observed serving", () => {
    expect(goLiveDecision(base())).toEqual({
      announce: true,
      to: "owner@example.com",
      origin: "https://chez-amara.sofrapiwas.com",
    });
  });
});

describe("goLiveDecision — only an observed probe counts", () => {
  // The rule the whole feature turns on: every stage below "ready" is explicitly
  // NOT evidence the app serves, and a mail cannot be taken back the way a panel
  // re-renders. Announcing early sends a paying customer to a connection error as
  // the first thing they were ever told to do.
  it.each(["none", "preparing", "settingUp", "almostReady"] as const)(
    "refuses to announce from %s",
    (stage) => {
      expect(goLiveDecision(base({ stage }))).toEqual({
        announce: false,
        reason: "notReady",
      });
    },
  );

  it("refuses almostReady even though a registry entry exists", () => {
    // almostReady means in the registry but the probe did not answer — the exact
    // state a merged-but-still-building tenant sits in.
    const out = goLiveDecision(base({ stage: "almostReady" }));
    expect(out.announce).toBe(false);
  });
});

describe("goLiveDecision — announced once, ever", () => {
  it("does not re-announce", () => {
    // This runs on a schedule; without the marker a live tenant would be
    // re-announced every 15 minutes for the rest of its life.
    expect(goLiveDecision(base({ alreadyAnnounced: true }))).toEqual({
      announce: false,
      reason: "alreadyAnnounced",
    });
  });

  it("reports notReady before alreadyAnnounced", () => {
    const out = goLiveDecision(base({ stage: "preparing", alreadyAnnounced: true }));
    expect(out).toEqual({ announce: false, reason: "notReady" });
  });
});

describe("goLiveDecision — unusable targets", () => {
  it.each([null, undefined, ""])("refuses without a recipient (%s)", (to) => {
    expect(goLiveDecision(base({ to }))).toEqual({
      announce: false,
      reason: "noRecipient",
    });
  });

  it("refuses when the registry domain did not yield an origin", () => {
    // tenantOrigin() rejects schemes, ports, paths and IP literals. A malformed
    // entry must produce no mail rather than a mail with a broken button.
    expect(goLiveDecision(base({ origin: null }))).toEqual({
      announce: false,
      reason: "unusableDomain",
    });
  });

  it("prefers noRecipient over unusableDomain, naming the first thing to fix", () => {
    const out = goLiveDecision(base({ to: null, origin: null }));
    expect(out).toEqual({ announce: false, reason: "noRecipient" });
  });
});

describe("goLiveDecision — never announces retroactively", () => {
  // Measured against the LIVE control plane before merge: the candidate set
  // included tenant 1 (RUMI) — paid, in the registry, and answering /api/health.
  // Without this guard its owner, a real paying client live since June, would have
  // been mailed "your restaurant is live 🎉, set your admin password".
  it("refuses a tenant that paid before the feature existed", () => {
    const out = goLiveDecision(base({ firstPaidAt: new Date("2026-06-01T00:00:00Z") }));
    expect(out).toEqual({ announce: false, reason: "predatesFeature" });
  });

  it("treats a missing payment date as too old, never as new enough", () => {
    expect(goLiveDecision(base({ firstPaidAt: null }))).toEqual({
      announce: false,
      reason: "predatesFeature",
    });
  });

  it("announces a tenant that paid exactly at the cutoff", () => {
    expect(goLiveDecision(base({ firstPaidAt: CUTOFF })).announce).toBe(true);
  });

  it("refuses one that paid a millisecond before it", () => {
    const out = goLiveDecision(base({ firstPaidAt: new Date(CUTOFF.getTime() - 1) }));
    expect(out).toEqual({ announce: false, reason: "predatesFeature" });
  });

  it("reports predatesFeature before alreadyAnnounced", () => {
    const out = goLiveDecision(
      base({ firstPaidAt: new Date("2026-01-01T00:00:00Z"), alreadyAnnounced: true }),
    );
    expect(out).toEqual({ announce: false, reason: "predatesFeature" });
  });
});

describe("goLiveDecision — a partner's tenants are not ours to write to", () => {
  // White-label resale: the partner owns the customer relationship and runs the
  // handover. On the live data a reseller plan's TenantBilling.email is the
  // PARTNER's address (tenant 1's restaurant has none on file), so announcing
  // would mail the wrong person about someone else's customer.
  it("refuses a reseller-held plan even when everything else is perfect", () => {
    expect(goLiveDecision(base({ partnerManaged: true }))).toEqual({
      announce: false,
      reason: "partnerManaged",
    });
  });

  it("still announces a direct-owner plan", () => {
    expect(goLiveDecision(base({ partnerManaged: false })).announce).toBe(true);
  });

  it("reports partnerManaged before the age cutoff", () => {
    const out = goLiveDecision(base({ partnerManaged: true, firstPaidAt: null }));
    expect(out).toEqual({ announce: false, reason: "partnerManaged" });
  });
});
