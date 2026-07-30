import { describe, expect, it } from "vitest";
import { decideSelfServe, type SelfServeInput } from "@/lib/self-serve-signup";
import { sanitizeSignupConfiguration } from "@/lib/signup-configuration";
import { quoteModules } from "@/lib/module-catalog";

/** A fully-configured, usable signup — the happy path each test perturbs. */
const base = (over: Partial<SelfServeInput> = {}): SelfServeInput => ({
  slug: "chez-amara",
  slugVerdict: "available",
  registryAvailable: true,
  existingAccount: null,
  slugClaimedBySameEmail: false,
  config: sanitizeSignupConfiguration({
    modules: "core,kitchen-board,cashier",
    languages: "en,fr",
    template: "craft",
    currency: "CHF",
  }),
  ...over,
});

describe("decideSelfServe — the account path", () => {
  it("mints an account for a usable slug and a real configuration", () => {
    const out = decideSelfServe(base());
    expect(out.kind).toBe("account");
    if (out.kind !== "account") return;
    expect(out.slug).toBe("chez-amara");
    expect(out.modules).toContain("core");
  });

  it("prices from the catalog, not from the stored quote", () => {
    // The invariant that matters: a crafted POST must not be able to set a price.
    // Corrupt the stored quote and the decision must ignore it entirely.
    const config = sanitizeSignupConfiguration({ modules: "core,kitchen-board,cashier" });
    const tampered = { ...config, quotedCents: 1 };
    const out = decideSelfServe(base({ config: tampered }));
    expect(out.kind).toBe("account");
    if (out.kind !== "account") return;
    expect(out.amountCents).not.toBe(1);
    expect(out.amountCents).toBe(quoteModules(["core", "kitchen-board", "cashier"]).monthlyCents);
  });
});

describe("decideSelfServe — refusals the customer can fix", () => {
  it.each([
    ["taken", "slugTaken"],
    ["reserved", "slugReserved"],
    ["invalid", "slugInvalid"],
  ] as const)("refuses a %s slug with %s", (verdict, reason) => {
    const out = decideSelfServe(base({ slugVerdict: verdict }));
    expect(out).toEqual({ kind: "refuse", reason });
  });

  it("decides the slug before the configuration, so a refusal never half-creates", () => {
    const out = decideSelfServe(
      base({ slugVerdict: "taken", config: sanitizeSignupConfiguration({}) }),
    );
    expect(out).toEqual({ kind: "refuse", reason: "slugTaken" });
  });
});

describe("decideSelfServe — never binds a plan to an account it can't prove control of", () => {
  it.each(["ADMIN", "PARTNER", "OWNER"] as const)(
    "hands an existing %s email to the founder instead of creating a plan on it",
    (role) => {
      // The attack this closes: an anonymous POST with a known owner's address and a
      // free slug would otherwise create a priced plan on THEIR account and email
      // them "a new plan is waiting", putting a pay button for a restaurant they
      // never ordered on their dashboard.
      expect(decideSelfServe(base({ existingAccount: { role, status: "ACTIVE" } }))).toEqual({
        kind: "leadOnly",
        reason: "emailAlreadyHasAccount",
      });
    },
  );

  it("calls out a DISABLED account specifically — it can neither log in nor reset", () => {
    // Worst historical case: it took the account branch, got no invite token (only
    // INVITED accounts do), and was mailed "sign in to your dashboard" for an
    // account lib/auth.ts and forgotPasswordAction both refuse — an unpayable plan
    // holding the slug forever.
    expect(
      decideSelfServe(base({ existingAccount: { role: "OWNER", status: "DISABLED" } })),
    ).toEqual({ kind: "leadOnly", reason: "accountDisabled" });
  });

  it("also covers an INVITED account (a half-finished earlier signup)", () => {
    expect(
      decideSelfServe(base({ existingAccount: { role: "OWNER", status: "INVITED" } })),
    ).toEqual({ kind: "leadOnly", reason: "emailAlreadyHasAccount" });
  });
});

describe("decideSelfServe — fallbacks the customer cannot fix", () => {
  it("refuses to mint anything when the registry could not be read", () => {
    // With no registry, the `taken` half of the verdict only saw billing slugs, so
    // any LIVE tenant without a billing row (RUMI, every founder-provisioned
    // tenant) reads as available. Failing open here would charge a customer on the
    // live key for someone else's subdomain, with a manual refund as the remedy.
    expect(decideSelfServe(base({ registryAvailable: false }))).toEqual({
      kind: "leadOnly",
      reason: "registryUnavailable",
    });
  });

  it("treats the same person resubmitting as a lead, not a slug collision", () => {
    // The shape a lost welcome email takes. Answering `slugTaken` about the address
    // they themselves just claimed is a dead end: no lead, no founder notice, no
    // way in. This must outrank the slug verdict.
    expect(
      decideSelfServe(base({ slugVerdict: "taken", slugClaimedBySameEmail: true })),
    ).toEqual({ kind: "leadOnly", reason: "alreadySignedUp" });
  });

  it("captures a lead when there is nothing to price", () => {
    const config = sanitizeSignupConfiguration({});
    expect(config.modules).toBeNull();
    expect(decideSelfServe(base({ config }))).toEqual({
      kind: "leadOnly",
      reason: "nothingConfigured",
    });
  });

  it("captures a lead when no slug was chosen, without calling it a refusal", () => {
    // The pre-O2 form had an optional slug. A cached bundle posting none must land
    // as a lead, not as a 409 the customer can make no sense of.
    expect(decideSelfServe(base({ slug: "", slugVerdict: "invalid" }))).toEqual({
      kind: "leadOnly",
      reason: "noSlugChosen",
    });
  });
});
