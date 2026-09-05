import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountStatusRow,
  accountStatusUpsert,
  type StripeAccountObject,
} from "@/lib/stripe-account-status";

// Shaped from a REAL Express account read off the Stripe API in test mode
// 2026-09-05 (acct_1UCPNg…, since deleted; GET on it now returns 403), not from
// the documentation.
const account = (over: Partial<StripeAccountObject> = {}): StripeAccountObject => ({
  id: "acct_1UCPNgFqVH9gPNlT",
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements: {
    currently_due: [
      "individual.dob.day",
      "individual.dob.month",
      "individual.dob.year",
      "individual.phone",
      "tos_acceptance.date",
      "tos_acceptance.ip",
    ],
  },
  capabilities: { twint_payments: "inactive" },
  ...over,
});

const AT = new Date("2026-09-05T19:30:00.000Z");

describe("accountStatusRow", () => {
  it("records the three enabled flags separately", () => {
    // They move independently. A restaurant taking cards whose PAYOUTS are
    // blocked is a support call nobody would otherwise see coming, and
    // `details_submitted` is neither of the other two — an account under review
    // has submitted everything and still cannot charge.
    const row = accountStatusRow(
      account({ charges_enabled: true, payouts_enabled: false, details_submitted: true }),
      AT,
    );
    expect(row.chargesEnabled).toBe(true);
    expect(row.payoutsEnabled).toBe(false);
    expect(row.detailsSubmitted).toBe(true);
  });

  it("counts what is still due rather than storing Stripe's field names", () => {
    // 6 is the measured remainder for a fully prefilled CH Express account:
    // dob x3, phone, tos.date, tos.ip.
    expect(accountStatusRow(account(), AT).requirementsDueCount).toBe(6);
    expect(accountStatusRow(account({ requirements: { currently_due: [] } }), AT).requirementsDueCount).toBe(0);
  });

  it("keeps the TWINT capability, including the difference between inactive and absent", () => {
    // `inactive` means requested and waiting; absent means the account does not
    // list the capability at all. Flattening them would hide the one state with a
    // Stripe-side approval queue behind it.
    expect(accountStatusRow(account(), AT).twintCapability).toBe("inactive");
    expect(accountStatusRow(account({ capabilities: {} }), AT).twintCapability).toBeNull();
    expect(accountStatusRow(account({ capabilities: undefined }), AT).twintCapability).toBeNull();
    expect(accountStatusRow(account({ capabilities: { twint_payments: "active" } }), AT).twintCapability).toBe("active");
  });

  it("falls to the SAFE side when Stripe omits a flag", () => {
    // A missing capability must never render as a live tenant. An absent
    // requirements list is the opposite case and genuinely means nothing is due.
    const bare = accountStatusRow({ id: "acct_1Bare" }, AT);
    expect(bare.chargesEnabled).toBe(false);
    expect(bare.payoutsEnabled).toBe(false);
    expect(bare.detailsSubmitted).toBe(false);
    expect(bare.requirementsDueCount).toBe(0);
    expect(bare.twintCapability).toBeNull();
  });

  it("takes the observation time from the caller, never from an ambient clock", () => {
    // A snapshot's only interesting property is its age, so the moment it was
    // taken has to be assertable — same discipline as lib/trial.ts.
    expect(accountStatusRow(account(), AT).observedAt).toBe(AT);
  });
});

describe("accountStatusUpsert — the anchor, and why it overwrites", () => {
  it("keys the write on connectedAccountId and on nothing else", () => {
    expect(accountStatusUpsert(account(), AT).where).toEqual({
      connectedAccountId: "acct_1UCPNgFqVH9gPNlT",
    });
  });

  it("REWRITES the row on a second delivery, unlike the fee tables", () => {
    // The opposite of `feeEarnedUpsert`, whose `update` is deliberately empty. A
    // fee is an immutable event; a status is a snapshot, so a second delivery has
    // everything to say. Safe only because the caller re-reads the account from
    // Stripe first, so what lands is today's truth however old the event was.
    const write = accountStatusUpsert(account({ charges_enabled: true }), AT);
    expect(write.update.chargesEnabled).toBe(true);
    expect(Object.keys(write.update).sort()).toEqual(
      ["chargesEnabled", "detailsSubmitted", "observedAt", "payoutsEnabled", "requirementsDueCount", "twintCapability"],
    );
    // The anchor is never in the update — repointing a row's account id would
    // move one restaurant's status onto another's account.
    expect(Object.keys(write.update)).not.toContain("connectedAccountId");
  });

  it("creates exactly the row accountStatusRow computes", () => {
    expect(accountStatusUpsert(account(), AT).create).toEqual(accountStatusRow(account(), AT));
  });
});

// The BRANCH POSITION is a property of the route file, not of any function, and
// it is load-bearing twice over: above the `event.account` guard is reserved for
// `application_fee.created`, which has no `event.account` at all (measured), and
// below it is where an event that names its account has to be. Read off disk, in
// keeping with §7 (no DB, no network), the same way the migration constraints are
// asserted in connect-account-store.test.ts.
const routeSource = readFileSync(
  fileURLToPath(new URL("../../app/api/webhooks/stripe/route.ts", import.meta.url)),
  "utf8",
);

describe("the account.updated branch sits below the account guard", () => {
  const at = (needle: string) => {
    const i = routeSource.indexOf(needle);
    expect(i, `route.ts no longer contains ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("handles application_fee.created ABOVE the guard", () => {
    expect(at('event.type === "application_fee.created"')).toBeLessThan(at("const account = event.account;"));
  });

  it("handles account.updated BELOW the guard", () => {
    // Moved above it, this branch would run for platform events that name no
    // account and would call Stripe with `undefined`. Left out entirely, nothing
    // would ever learn that a restaurant finished onboarding. Anchored on the CALL
    // rather than on the event-type string, because that string also appears in
    // the warning below and `indexOf` would find the wrong one.
    expect(at("recordAccountStatus(account)")).toBeGreaterThan(at("const account = event.account;"));
  });

  it("says out loud if an account.updated ever arrives without an account", () => {
    // The failure this guards is silence: the branch simply never firing, whose
    // only symptom is an empty table — the exact shape that hid
    // `application_fee.created` until someone went looking.
    expect(at("account.updated with no event.account")).toBeLessThan(at("recordAccountStatus(account)"));
  });
});
