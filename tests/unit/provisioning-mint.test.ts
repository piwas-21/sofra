import { afterEach, describe, expect, it } from "vitest";
import { mintForProposal } from "@/lib/provisioning-mint";

// The seam where the ADR-011 amendment's provenance flip actually happens. These do not
// mock Stripe (CLAUDE.md §7 forbids it) — they exercise the branches that DECIDE not to
// call it. If any of those decisions moved below the call, these tests would reach the
// real API from a suite that has no key, which is a loud failure rather than a quiet one.

const KEY = "STRIPE_API_KEY";
const originalKey = process.env[KEY];

afterEach(() => {
  if (originalKey === undefined) delete process.env[KEY];
  else process.env[KEY] = originalKey;
});

const input = {
  slug: "bistro-nova",
  name: "Bistro Nova",
  adminEmail: "owner@example.com",
  currency: "CHF",
  modules: ["core", "reservations"],
  url: "https://bistro-nova.sofrapiwas.com",
};

describe("mintForProposal", () => {
  it("mints nothing for a tenant that did not buy online payments", async () => {
    // A live Stripe connected account is a real object with a real compliance
    // obligation attached. Creating one for a restaurant that never asked for card
    // payments is not a harmless default.
    process.env[KEY] = "sk_test_not_used_by_this_branch";
    await expect(mintForProposal(input)).resolves.toEqual({});
  });

  it("says so, and does not throw, when the control plane has no Stripe key", async () => {
    // Its caller chain ends at the Mollie webhook, where a throw means a non-2xx, which
    // means a paid customer's activation is redelivered for ~26h.
    delete process.env[KEY];
    const result = await mintForProposal({ ...input, modules: ["core", "online-payments"] });
    expect(result.stripeAccount).toBeUndefined();
    expect(result.note).toMatch(/STRIPE_API_KEY is not configured/);
  });

  it("refuses to guess a country from EUR — before any network call", async () => {
    // Reached with a key present, so the ONLY thing that can stop a network call here is
    // the country decision itself. Stripe fixes an account's country permanently at
    // creation, so this refusal is the difference between a hand-edit and a dead account.
    process.env[KEY] = "sk_test_never_reaches_the_wire";
    const result = await mintForProposal({
      ...input,
      currency: "EUR",
      modules: ["core", "online-payments"],
    });
    expect(result.stripeAccount).toBeUndefined();
    expect(result.note).toMatch(/EUR does not name one country/);
  });
});
