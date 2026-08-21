import { describe, expect, it } from "vitest";
import { resendPlan } from "@/lib/invite-resend";

// The rule behind "resend my invite" (G12). Every case here is a decision about
// what leaves the building, never about what the form answers — the form answers
// the same generic sentence to everyone, which is why these branches can be this
// specific without leaking anything.

describe("resendPlan", () => {
  it("sends a set-password link to an account that has never set one", () => {
    expect(resendPlan({ status: "INVITED" })).toEqual({ kind: "invite" });
  });

  it("sends a LOGIN link to an account that already has a password", () => {
    // Not a set-password link: inviting someone to reset a password they know is
    // how a working account becomes a support ticket.
    expect(resendPlan({ status: "ACTIVE" })).toEqual({ kind: "login" });
  });

  it("sends NOTHING to a disabled account", () => {
    // It must not be able to talk itself back into a live link — the same refusal
    // setPasswordAction makes for a leftover token.
    expect(resendPlan({ status: "DISABLED" })).toEqual({ kind: "none" });
  });

  it("sends nothing for an address with no account", () => {
    expect(resendPlan(null)).toEqual({ kind: "none" });
  });

  it("gives an UNKNOWN status the weaker link, not the stronger one", () => {
    // A status this rule has never heard of must not be handed the ability to set
    // a password.
    expect(resendPlan({ status: "SOMETHING_NEW" })).toEqual({ kind: "login" });
  });
});
