import { describe, expect, it } from "vitest";
import { applyMintToProvisionInput } from "@/lib/provisioning-mint";

// The fold between the mint and the registry entry. Both SIDES were well covered —
// `mintForProposal` by tests/e2e/connect-mint.spec.ts against the real Stripe test API, and
// `buildTenantRegistryEntry` by tests/unit/provisioning-registry.test.ts — while the five lines
// that decide WHICH output lands in WHICH field sat inside `openProvisioningPr`, which cannot be
// reached without a PROVISION_GITHUB_TOKEN. That is why this was extracted.
//
// The failure it guards is silent and expensive: `stripe_account:` receiving a URL is a registry
// entry that provisions a tenant pointed at an account that does not exist, and nothing downstream
// would notice — `provision-tenant.sh` only checks the pairing, not the shape.

const base = { slug: "bistro-nova", name: "Bistro Nova" };

describe("applyMintToProvisionInput", () => {
  it("puts each of the mint's three outputs in its own field", () => {
    const out = applyMintToProvisionInput(base, {
      stripeAccount: "acct_123",
      paymentsLinkUrl: "https://sofrapiwas.com/onboarding/payments/tok",
      note: "a note",
    });
    // Asserted field by field rather than with one toEqual: a swap is the failure being
    // guarded, and toEqual on a whole object reports "not equal" without naming which pair
    // moved.
    expect(out.stripeAccount).toBe("acct_123");
    expect(out.paymentsLinkUrl).toBe("https://sofrapiwas.com/onboarding/payments/tok");
    expect(out.stripeAccountNote).toBe("a note");
  });

  it("keeps the base input intact", () => {
    const out = applyMintToProvisionInput(base, { stripeAccount: "acct_123" });
    expect(out.slug).toBe("bistro-nova");
    expect(out.name).toBe("Bistro Nova");
  });

  it("OMITS a key it has no value for, rather than setting it undefined", () => {
    // Not pedantry. `buildTenantRegistryEntry` distinguishes an absent key from one present
    // and undefined, so `{ stripeAccount: undefined }` can emit a blank `stripe_account:` line
    // that provision-tenant.sh reads as configured-but-empty.
    const out = applyMintToProvisionInput(base, { note: "mint failed" });
    expect("stripeAccount" in out).toBe(false);
    expect("paymentsLinkUrl" in out).toBe(false);
    expect(out.stripeAccountNote).toBe("mint failed");
  });

  it("adds nothing at all when the mint returns {} (the tenant bought no paired module)", () => {
    const out = applyMintToProvisionInput(base, {});
    expect(Object.keys(out).sort()).toEqual(["name", "slug"]);
  });

  it("carries an account and a note together", () => {
    // Reachable in principle: an account minted, and a note about something else.
    const out = applyMintToProvisionInput(base, { stripeAccount: "acct_9", note: "heads up" });
    expect(out.stripeAccount).toBe("acct_9");
    expect(out.stripeAccountNote).toBe("heads up");
  });
});
