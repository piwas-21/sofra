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

// THE INVARIANT, not the value. Two code paths compute one price: the sanitizer
// writes `quotedCents` (what the buyer is SHOWN and what the founder's queue
// prints) and `decideSelfServe` computes `amountCents` (what the plan is BILLED —
// the Mollie subscription amount and the figure in the welcome email). They are
// meant to be the same number, and until 2026-09-05 they silently were not: the
// billing side re-quoted the modules and forgot the payments mode, so a buyer who
// chose `commission` was quoted EUR 10 less than they would be charged (EUR 19 less
// before the commission floor landed).
//
// Asserting the two AGREE is what pins that shut. A value assertion would pass just
// as happily with the two paths drifting apart again the next time either side
// learns a new adjustment — which is exactly how this defect arrived.
describe("the quoted price and the billed price cannot disagree", () => {
  const shownAndBilled = (raw: Parameters<typeof sanitizeSignupConfiguration>[0]) => {
    const config = sanitizeSignupConfiguration(raw);
    const out = decideSelfServe(base({ config }));
    if (out.kind !== "account") throw new Error(`expected an account, got ${out.kind}`);
    return { shown: config.quotedCents, billed: out.amountCents, config };
  };

  it.each([
    ["commission, with the module", { modules: "core,online-payments", paymentsMode: "commission" }],
    ["flat, with the module", { modules: "core,online-payments", paymentsMode: "flat" }],
    ["commission, no module (degrades to flat)", { modules: "core,loyalty", paymentsMode: "commission" }],
    ["no mode posted at all", { modules: "core,online-payments" }],
    // A bundle, because the mode adjustment is applied on top of bundle pricing and
    // the two paths must agree there too — not only on a plain sum of list prices.
    [
      "commission on top of a bundle",
      { modules: "core,kitchen-board,cashier,printing,online-payments", paymentsMode: "commission" },
    ],
  ])("agrees for %s", (_case, raw) => {
    const { shown, billed } = shownAndBilled(raw);
    expect(billed).toBe(shown);
  });

  // The case the defect was actually about, stated once as an absolute so a future
  // reader can see the real numbers rather than only the equality: core EUR 19 +
  // online-payments EUR 19 = EUR 38, less the EUR 10 the commission floor takes off.
  it("bills a commission buyer the EUR 28 they were shown, not the EUR 38 flat total", () => {
    const { shown, billed } = shownAndBilled({
      modules: "core,online-payments",
      paymentsMode: "commission",
    });
    expect(shown).toBe(2800);
    expect(billed).toBe(2800);
    expect(billed).not.toBe(quoteModules(["core", "online-payments"]).monthlyCents);
  });

  // The control: the pair above proves nothing unless the two modes actually differ.
  // If commission and flat ever quoted the same total, every assertion here would
  // pass while measuring nothing.
  it("the two modes really do cost different amounts, or the tests above are vacuous", () => {
    const commission = shownAndBilled({
      modules: "core,online-payments",
      paymentsMode: "commission",
    });
    const flat = shownAndBilled({ modules: "core,online-payments", paymentsMode: "flat" });
    expect(commission.billed).not.toBe(flat.billed);
    expect(flat.billed - commission.billed).toBe(1000);
  });
});
