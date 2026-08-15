import { describe, expect, it } from "vitest";
import { interpretSignupResponse } from "@/lib/signup-outcome";

/**
 * EMAIL-SPEC-CONTROL-PLANE G5. The branch worth testing is the invisible one: an
 * account IS created and the welcome email is NOT sent. That is not an error the
 * customer can act on — resubmitting is refused, their email now having a plan
 * for that address — so it needs its own copy, and it has to be reachable from
 * the response alone.
 */
describe("interpretSignupResponse", () => {
  const ok = (body: Record<string, unknown>) => interpretSignupResponse(200, body, true);

  it("promises the email only when one was actually sent", () => {
    expect(ok({ ok: true, account: true, emailed: true })).toBe("success");
    expect(ok({ ok: true, account: true, emailed: false })).toBe("successNoEmail");
  });

  it("keeps the promise when the server did not say — an older deployment", () => {
    // "Unknown" resolves to the claim we can keep: the account exists either
    // way, and telling someone their mail failed when it did not sends them to
    // support for nothing.
    expect(ok({ ok: true, account: true })).toBe("success");
  });

  it("a lead is never told to check an inbox, sent or not", () => {
    expect(ok({ ok: true, account: false, emailed: false })).toBe("successLead");
    expect(ok({ ok: true, account: false, emailed: true })).toBe("successLead");
  });

  it("keeps the two fixable slug refusals apart from a real error", () => {
    const refused = (reason: string) => interpretSignupResponse(409, { ok: false, reason }, false);

    expect(refused("slugTaken")).toBe("slugTaken");
    expect(refused("slugReserved")).toBe("slugReserved");
    // Unreachable from a browser, but a name mismatch between the two sides must
    // not collapse into "something went wrong" — that reads as "try again" and
    // the customer would retype the same slug forever.
    expect(refused("slugInvalid")).toBe("invalidSlug");
    expect(refused("somethingNew")).toBe("error");
    expect(interpretSignupResponse(409, null, false)).toBe("error");
  });

  it("defers to the caller when the answer is not one it recognises", () => {
    expect(interpretSignupResponse(500, null, false)).toBeNull();
    expect(interpretSignupResponse(200, { ok: false }, true)).toBeNull();
    expect(interpretSignupResponse(200, null, true)).toBeNull();
  });
});
