import { describe, expect, it } from "vitest";
import { goLiveDecision, type GoLiveFacts } from "@/lib/go-live-policy";

/** A live, never-announced tenant with a usable address — the one case that sends. */
const base = (over: Partial<GoLiveFacts> = {}): GoLiveFacts => ({
  stage: "ready",
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
