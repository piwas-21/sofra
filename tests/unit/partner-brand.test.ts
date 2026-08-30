import { describe, expect, it } from "vitest";
import {
  checkboxOn,
  isLegalNameEcho,
  partnerBrandSchema,
  prefillFromBillingIdentity,
  renderableBrand,
  type StoredBrand,
} from "@/lib/partner-brand";

// The pure half of a partner's PUBLIC brand (SOFRA-PARTNER-PLAN §11).
//
// Two things are being defended here and they are different. The schema decides
// what a partner is ALLOWED TO STORE — the interesting cases are the refusals,
// because an accepted `javascript:` URL becomes an `href` on a stranger's
// restaurant page. `renderableBrand` decides what may be SHOWN, and its whole
// value is a negative: a complete, well-filled record that was never opted in
// must come back as `null`.

const parse = (over: Record<string, unknown> = {}) =>
  partnerBrandSchema.safeParse({ displayName: "Solution Eva", publishToTenants: false, ...over });

const full: StoredBrand = {
  displayName: "Solution Eva",
  tagline: "Restaurant software, set up for you",
  websiteUrl: "https://solutioneva.com",
  email: "hello@solutioneva.com",
  phone: "+41 22 000 00 00",
  addressLine1: "Rue du Rhône 1",
  postalCode: "1204",
  city: "Genève",
  countryCode: "CH",
  publishToTenants: true,
};

describe("partnerBrandSchema — displayName", () => {
  it("accepts a plain brand name", () => {
    const r = parse();
    expect(r.success && r.data.displayName).toBe("Solution Eva");
  });
  it("trims", () => {
    const r = parse({ displayName: "  Solution Eva  " });
    expect(r.success && r.data.displayName).toBe("Solution Eva");
  });
  it("refuses an empty name — the record means nothing without one", () => {
    expect(parse({ displayName: "" }).success).toBe(false);
  });
  it("refuses whitespace posing as a name", () => {
    expect(parse({ displayName: "   " }).success).toBe(false);
  });
  it("refuses over 80 characters", () => {
    expect(parse({ displayName: "a".repeat(81) }).success).toBe(false);
  });
});

describe("partnerBrandSchema — websiteUrl is https or nothing", () => {
  it("accepts an https address", () => {
    const r = parse({ websiteUrl: "https://solutioneva.com" });
    expect(r.success && r.data.websiteUrl).toBe("https://solutioneva.com");
  });
  it("accepts one with a path", () => {
    expect(parse({ websiteUrl: "https://solutioneva.com/fr/contact" }).success).toBe(true);
  });
  // The three refusals that matter, and why each is not a style preference:
  it("refuses http — we would be advertising a downgrade on someone else's site", () => {
    expect(parse({ websiteUrl: "http://solutioneva.com" }).success).toBe(false);
  });
  it("refuses javascript: — that is script execution in a reader's page", () => {
    expect(parse({ websiteUrl: "javascript:alert(1)" }).success).toBe(false);
  });
  it("refuses a bare host rather than guessing a scheme for it", () => {
    expect(parse({ websiteUrl: "solutioneva.com" }).success).toBe(false);
  });
  it("refuses data: too", () => {
    expect(parse({ websiteUrl: "data:text/html,<script>1</script>" }).success).toBe(false);
  });
});

describe("partnerBrandSchema — countryCode is a COUNTRY, not two letters", () => {
  it("accepts CH", () => {
    const r = parse({ countryCode: "CH" });
    expect(r.success && r.data.countryCode).toBe("CH");
  });
  it("uppercases and trims", () => {
    const r = parse({ countryCode: " ch " });
    expect(r.success && r.data.countryCode).toBe("CH");
  });
  // The same negative control `lib/country-code.ts` was written for: `SW` is
  // assigned to nothing, and it sat on a live record for nine days looking fine.
  it("refuses SW, which is not assigned to anything", () => {
    expect(parse({ countryCode: "SW" }).success).toBe(false);
  });
  it("refuses UK, the common mistake for GB", () => {
    expect(parse({ countryCode: "UK" }).success).toBe(false);
  });
  it("refuses a three-letter code", () => {
    expect(parse({ countryCode: "CHE" }).success).toBe(false);
  });
});

describe("partnerBrandSchema — an untouched field is ABSENT, not empty", () => {
  it("turns every blank optional into undefined", () => {
    const r = parse({
      tagline: "",
      websiteUrl: "   ",
      email: "",
      phone: "",
      addressLine1: "",
      postalCode: "",
      city: "",
      countryCode: "  ",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    for (const key of [
      "tagline",
      "websiteUrl",
      "email",
      "phone",
      "addressLine1",
      "postalCode",
      "city",
      "countryCode",
    ] as const) {
      expect(r.data[key], `${key} should be undefined, not ""`).toBeUndefined();
    }
  });
  it("still refuses a malformed email when one IS given", () => {
    expect(parse({ email: "not-an-address" }).success).toBe(false);
  });
  it("caps an over-long optional field", () => {
    expect(parse({ tagline: "a".repeat(121) }).success).toBe(false);
  });
  it("requires publishToTenants to be a boolean, never a form string", () => {
    expect(parse({ publishToTenants: "on" }).success).toBe(false);
  });
});

describe("checkboxOn", () => {
  it("reads a ticked box", () => expect(checkboxOn("on")).toBe(true));
  it("reads the explicit string", () => expect(checkboxOn("true")).toBe(true));
  it("an absent box is off", () => expect(checkboxOn(null)).toBe(false));
  it("anything else is off — the safe direction for a publish flag", () => {
    expect(checkboxOn("yes")).toBe(false);
    expect(checkboxOn("1")).toBe(false);
    expect(checkboxOn(true)).toBe(false);
  });
});

describe("prefillFromBillingIdentity — one field crosses, and only one", () => {
  it("takes the trade name", () => {
    expect(prefillFromBillingIdentity({ legalName: "Eva Obresse", tradeName: "Solution Eva" })).toEqual(
      { displayName: "Solution Eva" },
    );
  });
  it("falls back to the legal name when there is no trade name", () => {
    expect(prefillFromBillingIdentity({ legalName: "Eva Obresse", tradeName: null })).toEqual({
      displayName: "Eva Obresse",
    });
  });
  it("ignores a blank trade name rather than prefilling an empty box", () => {
    expect(prefillFromBillingIdentity({ legalName: "Eva Obresse", tradeName: "   " })).toEqual({
      displayName: "Eva Obresse",
    });
  });
  it("returns null when there is no identity at all", () => {
    expect(prefillFromBillingIdentity(null)).toBeNull();
    expect(prefillFromBillingIdentity(undefined)).toBeNull();
    expect(prefillFromBillingIdentity({ legalName: "  ", tradeName: null })).toBeNull();
  });
  // The load-bearing assertion of the whole two-model split: a prefill carries a
  // NAME and cannot carry an address, because there is nowhere in its result for
  // one to go.
  it("carries exactly one key, so no address can ride along", () => {
    const out = prefillFromBillingIdentity({ legalName: "Eva Obresse", tradeName: "Solution Eva" });
    expect(Object.keys(out ?? {})).toEqual(["displayName"]);
  });
});

describe("renderableBrand — the single door", () => {
  // S3a TIGHTENED this projection to D-B1: `displayName` + `websiteUrl` and nothing
  // else. The assertions that named tagline/email/phone/address/postcode/city/country
  // were deliberately rewritten, which is the point of the direction — a footer that
  // stops carrying a partner's postal address announces itself in red here, whereas
  // adding those fields back would be silent and needs its own controls (D-B4).
  it("publishes an ATTRIBUTION: a name and a link, and nothing else", () => {
    expect(renderableBrand(full)).toEqual({
      displayName: "Solution Eva",
      websiteUrl: "https://solutioneva.com",
    });
  });
  it("carries no contact details at all, however full the record", () => {
    const out = renderableBrand(full) as Record<string, unknown>;
    for (const key of ["tagline", "email", "phone", "addressLine1", "postalCode", "city", "countryCode"]) {
      expect(out, `${key} must not be published`).not.toHaveProperty(key);
    }
    expect(Object.keys(out).sort()).toEqual(["displayName", "websiteUrl"]);
  });
  it("never leaks the flag itself into the projection", () => {
    expect(renderableBrand(full)).not.toHaveProperty("publishToTenants");
  });
  it("omits websiteUrl entirely when there is none — absent, never null", () => {
    const out = renderableBrand({ ...full, websiteUrl: null });
    expect(out).toEqual({ displayName: "Solution Eva" });
    expect(out).not.toHaveProperty("websiteUrl");
  });
  // Defence in depth: the write schema refuses these, so a row carrying one came from
  // somewhere else (an older row, a future admin tool, a hand-edited database). The
  // NAME still publishes — the partner asked for that — only the href is dropped.
  it("drops a non-https link rather than the whole credit", () => {
    for (const bad of ["javascript:alert(1)", "http://solutioneva.com", "solutioneva.com"]) {
      expect(renderableBrand({ ...full, websiteUrl: bad })).toEqual({ displayName: "Solution Eva" });
    }
  });

  // THE negative control. A record with every field filled in — the one a naive
  // caller would happily render — comes back as null purely because nobody opted
  // in. If this ever returns an object, a partner who never consented is in a
  // stranger's footer and nothing else in the system goes red.
  it("returns null for an UNPUBLISHED brand carrying full data", () => {
    expect(renderableBrand({ ...full, publishToTenants: false })).toBeNull();
  });
  it("returns null when there is no brand", () => {
    expect(renderableBrand(null)).toBeNull();
    expect(renderableBrand(undefined)).toBeNull();
  });
  it("returns null for a blank display name, whatever else is set", () => {
    expect(renderableBrand({ ...full, displayName: "   " })).toBeNull();
  });
});

describe("renderableBrand — D-B1a: it refuses the legal name", () => {
  // The catastrophic path this exists to close: `prefillFromBillingIdentity` offers
  // `tradeName ?? legalName`, so a sole trader with no trade name is offered their own
  // name, saves the form untouched, and would otherwise be published on a restaurant's
  // page by a convenience nobody decided on.
  const sole: StoredBrand = { ...full, displayName: "Mustafa Vural", websiteUrl: null };

  it("refuses an exact match", () => {
    expect(renderableBrand(sole, { legalName: "Mustafa Vural" })).toBeNull();
  });
  // The normalisation cases, and they are the realistic ones: a prefilled value that
  // was retyped, pasted with a trailing space, or shouted.
  it("refuses a match that differs only by whitespace and case", () => {
    expect(
      renderableBrand({ ...sole, displayName: "  mustafa   VURAL " }, { legalName: "Mustafa Vural" }),
    ).toBeNull();
  });
  it("refuses when the LEGAL name is the untidy one", () => {
    expect(renderableBrand(sole, { legalName: "  MUSTAFA vural  " })).toBeNull();
  });
  it("refuses the registry's own spelling of that partner", () => {
    // SOFRA-BILLING-IDENTITY-PLAN §6 records the one live reseller as `VURAL Mustafa`
    // trading as `SOLUTIONEVA` — the order is not the same, so this one must PASS.
    expect(renderableBrand(sole, { legalName: "VURAL Mustafa" })).toEqual({
      displayName: "Mustafa Vural",
    });
  });
  it("publishes a real brand belonging to the same person", () => {
    expect(renderableBrand(full, { legalName: "Mustafa Vural" })).toEqual({
      displayName: "Solution Eva",
      websiteUrl: "https://solutioneva.com",
    });
  });
  it("does not fire when no legal name is known — the rule needs both records", () => {
    expect(renderableBrand(sole)).toEqual({ displayName: "Mustafa Vural" });
    expect(renderableBrand(sole, { legalName: null })).toEqual({ displayName: "Mustafa Vural" });
    expect(renderableBrand(sole, { legalName: "   " })).toEqual({ displayName: "Mustafa Vural" });
  });
});

describe("isLegalNameEcho — the predicate the FORM shares with the choke point", () => {
  it("is true for the same name written differently", () => {
    expect(isLegalNameEcho("  mustafa   VURAL ", "Mustafa Vural")).toBe(true);
  });
  it("is false for a different name", () => {
    expect(isLegalNameEcho("Solution Eva", "Mustafa Vural")).toBe(false);
  });
  // Both halves blank would compare equal as "" — and would then hide a brand for a
  // reason that has nothing to do with the legal record.
  it("is false when either side is empty, rather than trivially true", () => {
    expect(isLegalNameEcho("", "")).toBe(false);
    expect(isLegalNameEcho("   ", null)).toBe(false);
    expect(isLegalNameEcho(null, "Mustafa Vural")).toBe(false);
    expect(isLegalNameEcho("Mustafa Vural", undefined)).toBe(false);
  });
});
