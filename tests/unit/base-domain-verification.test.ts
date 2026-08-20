import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_DAYS,
  expectedTxtValue,
  mintVerificationToken,
  txtMatchesToken,
  verificationAge,
  verifyRecordName,
} from "@/lib/base-domain-verification";

// The proof half of the base-domain security boundary. A false positive here is a
// certificate issued for a name we do not own, so the negative cases matter at least
// as much as the positive one.

const TOKEN = "a".repeat(64);

describe("the record a partner publishes", () => {
  it("lives under an underscore label, so it can never collide with a real host", () =>
    expect(verifyRecordName("solutioneva.com")).toBe("_sofra-verify.solutioneva.com"));
  it("says whose it is, so a zone tidy-up can tell", () =>
    expect(expectedTxtValue(TOKEN)).toBe(`sofra-verify=${TOKEN}`));
});

describe("mintVerificationToken", () => {
  it("is 32 bytes of hex", () => expect(mintVerificationToken()).toMatch(/^[0-9a-f]{64}$/));
  it("is different every time — two partners claiming one domain must not collide", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => mintVerificationToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("txtMatchesToken", () => {
  it("matches the published value", () =>
    expect(txtMatchesToken([[expectedTxtValue(TOKEN)]], TOKEN)).toBe(true));

  it("joins the chunks of a long record with NOTHING", () => {
    // A TXT value over 255 bytes arrives as several character-strings the consumer
    // concatenates. Joining with a space is the classic way to fail a correct zone.
    const value = expectedTxtValue(TOKEN);
    const chunks = [value.slice(0, 20), value.slice(20)];
    expect(txtMatchesToken([chunks], TOKEN)).toBe(true);
  });

  it("ignores surrounding quotes some zone editors keep", () =>
    expect(txtMatchesToken([[`"${expectedTxtValue(TOKEN)}"`]], TOKEN)).toBe(true));

  it("ignores surrounding whitespace", () =>
    expect(txtMatchesToken([[`  ${expectedTxtValue(TOKEN)}  `]], TOKEN)).toBe(true));

  it("accepts one match among a zone's other TXT records", () =>
    expect(
      txtMatchesToken(
        [["v=spf1 include:_spf.google.com ~all"], ["google-site-verification=xyz"], [expectedTxtValue(TOKEN)]],
        TOKEN,
      ),
    ).toBe(true));

  it("refuses another partner's token at the same name", () =>
    expect(txtMatchesToken([[expectedTxtValue("b".repeat(64))]], TOKEN)).toBe(false));

  it("refuses a bare token without the prefix", () =>
    expect(txtMatchesToken([[TOKEN]], TOKEN)).toBe(false));

  it("refuses a value that merely CONTAINS the token", () =>
    expect(txtMatchesToken([[`x ${expectedTxtValue(TOKEN)} y`]], TOKEN)).toBe(false));

  it("refuses an empty answer", () => expect(txtMatchesToken([], TOKEN)).toBe(false));

  it("refuses an empty token, whatever is published", () =>
    expect(txtMatchesToken([["sofra-verify="]], "")).toBe(false));
});

describe("verificationAge — record, surface, never auto-revoke", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("reports an unproven claim as unverified, with no age and no staleness", () =>
    expect(verificationAge(null, now)).toEqual({ verified: false, ageDays: null, stale: false }));

  it("counts whole days since the proof", () =>
    expect(verificationAge(new Date("2026-08-10T12:00:00.000Z"), now)).toEqual({
      verified: true,
      ageDays: 10,
      stale: false,
    }));

  it("is not stale one day before the threshold", () => {
    const at = new Date(now.getTime() - (STALE_AFTER_DAYS - 1) * 86_400_000);
    expect(verificationAge(at, now).stale).toBe(false);
  });

  it("is stale exactly ON the threshold", () => {
    const at = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000);
    expect(verificationAge(at, now)).toEqual({
      verified: true,
      ageDays: STALE_AFTER_DAYS,
      stale: true,
    });
  });

  it("stays VERIFIED when stale — staleness is news for the founder, not a revocation", () => {
    const at = new Date(now.getTime() - 5 * STALE_AFTER_DAYS * 86_400_000);
    expect(verificationAge(at, now).verified).toBe(true);
  });
});
