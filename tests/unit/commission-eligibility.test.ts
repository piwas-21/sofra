import { describe, expect, it } from "vitest";
import { commissionEligibility } from "@/lib/commission-eligibility";

// SOFRA-PAYMENTS-PRICING-MODE-PLAN S2b: the admin form's own gate — the common
// case is that a tenant is NOT eligible, because `provision-tenant.sh` refuses a
// non-zero rate without BOTH `online-payments` and a `stripe_account`, before the
// database.

describe("commissionEligibility", () => {
  it("is eligible when the entry carries the module AND the account", () => {
    expect(
      commissionEligibility({
        registryReadable: true,
        tenant: { modules: ["core", "online-payments"], stripe_account: "acct_1Example" },
      }),
    ).toEqual({ eligible: true });
  });

  it("is registryUnavailable when the registry could not be read at all", () => {
    expect(
      commissionEligibility({
        registryReadable: false,
        tenant: { modules: ["core", "online-payments"], stripe_account: "acct_1Example" },
      }),
    ).toEqual({ eligible: false, reason: "registryUnavailable" });
  });

  it("is registryUnavailable when the tenant has no registry entry at all", () => {
    // A billing plan can exist before its tenant is provisioned — there is
    // nothing here to check a pairing against, same as an unreadable registry.
    expect(commissionEligibility({ registryReadable: true, tenant: undefined })).toEqual({
      eligible: false,
      reason: "registryUnavailable",
    });
  });

  it("is notPaired when the entry never bought online-payments at all", () => {
    expect(
      commissionEligibility({
        registryReadable: true,
        tenant: { modules: ["core"], stripe_account: "acct_1Example" },
      }),
    ).toEqual({ eligible: false, reason: "notPaired" });
  });

  it("is notPaired when the entry bought the module but carries no account", () => {
    // The common case today: no tenant has a stripe_account yet.
    expect(
      commissionEligibility({
        registryReadable: true,
        tenant: { modules: ["core", "online-payments"] },
      }),
    ).toEqual({ eligible: false, reason: "notPaired" });
  });

  it("treats a whitespace-only account as absent, same as provision-tenant.sh's -z test", () => {
    expect(
      commissionEligibility({
        registryReadable: true,
        tenant: { modules: ["online-payments"], stripe_account: "   " },
      }),
    ).toEqual({ eligible: false, reason: "notPaired" });
  });
});
