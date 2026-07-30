import { describe, expect, it } from "vitest";
import {
  AUTO_PROPOSE_NOTES,
  classifyProvisioningRefusal,
  decideAutoPropose,
  type AutoProposeConfig,
  type AutoProposeFacts,
  type AutoProposeSkip,
} from "@/lib/auto-provision-policy";

const config = (over: Partial<AutoProposeConfig> = {}): AutoProposeConfig => ({
  slug: "bistro-nova",
  billingSlug: "bistro-nova",
  name: "Bistro Nova",
  template: "craft",
  currency: "EUR",
  modules: ["core", "reservations"],
  languages: ["en", "nl"],
  ...over,
});

const facts = (over: Partial<AutoProposeFacts> = {}): AutoProposeFacts => ({
  existingPrUrl: null,
  config: config(),
  settled: true,
  provisioningConfigured: true,
  ...over,
});

describe("decideAutoPropose", () => {
  it("proposes for a settled self-serve plan with a full configuration", () => {
    expect(decideAutoPropose(facts())).toEqual({ kind: "propose" });
  });

  it("reports an existing proposal instead of opening a second one", () => {
    // The ordinary repeat case, not an edge one: Mollie redelivers webhooks. The URL
    // rides along so a redelivery still tells the founder something useful.
    const url = "https://github.com/piwas-21/restaurant-app-deploy/pull/99";
    expect(decideAutoPropose(facts({ existingPrUrl: url }))).toEqual({
      kind: "alreadyProposed",
      prUrl: url,
    });
  });

  it("lets an existing proposal outrank every other verdict", () => {
    // If this ordering ever inverts, a redelivery for an unpaid or badly configured plan
    // would report a fresh skip about a tenant that has already been proposed.
    const url = "https://example.test/pr/1";
    for (const over of [
      { config: null },
      { settled: false },
      { provisioningConfigured: false },
      { config: config({ template: undefined }) },
    ] as Partial<AutoProposeFacts>[]) {
      expect(decideAutoPropose(facts({ ...over, existingPrUrl: url })).kind).toBe("alreadyProposed");
    }
  });

  it("skips a plan with no lead — that is the founder path, not a failure", () => {
    // No lead is exactly the signal the payment gate keys on: /admin/onboard, the
    // reseller flow, and RUMI all have none.
    expect(decideAutoPropose(facts({ config: null }))).toEqual({
      kind: "skipped",
      reason: "notSelfServe",
    });
  });

  it("refuses an unpaid plan before it looks at the configuration", () => {
    // A badly configured unpaid plan must report as unpaid: the gate is the security
    // property, and "fix your template" would be the wrong instruction.
    expect(
      decideAutoPropose(facts({ settled: false, config: config({ currency: undefined }) })),
    ).toEqual({ kind: "skipped", reason: "awaitingPayment" });
  });

  it("treats a slug mismatch as its own answer, not as incomplete", () => {
    // Conflating the two would send the founder to fill in a form when what they need to
    // do is find out why a plan bills against a slug its lead never asked for.
    expect(decideAutoPropose(facts({ config: config({ slug: "someone-else" }) }))).toEqual({
      kind: "skipped",
      reason: "slugMismatch",
    });
  });

  it("never guesses a missing choice", () => {
    // Template is baked into the tenant's image and currency prices their menu; neither
    // has a safe default for someone who has paid.
    for (const over of [
      { template: undefined },
      { currency: undefined },
      { modules: [] },
      { languages: [] },
    ] as Partial<AutoProposeConfig>[]) {
      expect(decideAutoPropose(facts({ config: config(over) }))).toEqual({
        kind: "skipped",
        reason: "incompleteConfiguration",
      });
    }
  });

  it("FAILS on a missing token rather than skipping — and only once eligible", () => {
    // PROVISION_GITHUB_TOKEN expires silently and /admin/provision degrades to a banner
    // nobody is looking at on this path, so it has to be loud.
    expect(decideAutoPropose(facts({ provisioningConfigured: false }))).toEqual({
      kind: "failed",
      detail: "PROVISION_GITHUB_TOKEN is unset or expired",
    });
    // ...but a plan that was never eligible must not raise a token alarm.
    expect(
      decideAutoPropose(facts({ provisioningConfigured: false, settled: false })).kind,
    ).toBe("skipped");
    expect(decideAutoPropose(facts({ provisioningConfigured: false, config: null })).kind).toBe(
      "skipped",
    );
  });

  it("refuses a name that cannot survive a Docker build arg", () => {
    // `signupSchema` guards this at intake now, but that guard is new — rows captured
    // before it can still hold a newline, and this name reaches
    // build-tenant-image.yml's NEWLINE-DELIMITED `build-args:`. The deploy chain also
    // rejects it, but only after the entry is merged, which would leave a paying
    // customer with a merged registry entry that never provisions.
    for (const name of ["Bistro\nNEXT_PUBLIC_API_URL=https://evil.test", "A\tB", "A\u0000B"]) {
      expect(decideAutoPropose(facts({ config: config({ name }) }))).toEqual({
        kind: "skipped",
        reason: "unsafeName",
      });
    }
    // An ordinary name with punctuation and non-ASCII is untouched.
    for (const name of ["Chez L'Ami", "Nova: Café — Bar", "北京饭店"]) {
      expect(decideAutoPropose(facts({ config: config({ name }) })).kind).toBe("propose");
    }
  });

  it("has a founder-facing note for EVERY skip reason, enumerated explicitly", () => {
    // Iterating AUTO_PROPOSE_NOTES would be vacuous — it can only contain what it
    // contains. Listing the union members is what makes adding a reason without a note
    // fail, here and at compile time.
    const reasons: AutoProposeSkip[] = [
      "notSelfServe",
      "awaitingPayment",
      "incompleteConfiguration",
      "slugMismatch",
      "unsafeName",
      "proposalExists",
    ];
    expect(Object.keys(AUTO_PROPOSE_NOTES).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) {
      expect(AUTO_PROPOSE_NOTES[reason], reason).toMatch(/^No automatic proposal/);
      expect(AUTO_PROPOSE_NOTES[reason].length, reason).toBeGreaterThan(20);
    }
  });
});

describe("classifyProvisioningRefusal", () => {
  it("tells a LIVE tenant apart from an open proposal", () => {
    // The first version of this lived in the shell, untested, and matched both with one
    // regex — so "that slug is already a live tenant" (money taken for a subdomain
    // someone else owns) was reported to the founder as "nothing to do".
    expect(classifyProvisioningRefusal("registry already has a 'demo' entry")).toBe("slugLive");
    expect(
      classifyProvisioningRefusal(
        "a provisioning proposal for 'demo' is already open (branch provision/demo exists)",
      ),
    ).toBe("proposalOpen");
  });

  it("does not guess at anything else", () => {
    for (const msg of ["GitHub POST /repos/x/y → 401: Bad credentials", "", "already"]) {
      expect(classifyProvisioningRefusal(msg)).toBe("other");
    }
  });
});
