import { describe, expect, it } from "vitest";
import { normalizeBaseDomain, tenantHostname } from "@/lib/base-domain";

// The syntax half of the base-domain security boundary. Everything that gets past
// this still has to prove a TXT record — but everything REFUSED here is a name we
// never even query, and the refusals that matter (our own zones, IP literals,
// special-use TLDs) are the ones a hand-check would wave through.

const ok = (raw: string, expected: string) => {
  const r = normalizeBaseDomain(raw);
  expect(r, `expected ${raw} to be accepted`).toEqual({ ok: true, domain: expected });
};
const rejected = (raw: string, reason: string) => {
  const r = normalizeBaseDomain(raw);
  expect(r, `expected ${raw} to be refused`).toEqual({ ok: false, reason });
};

describe("normalizeBaseDomain — accepted", () => {
  it("takes an ordinary company domain", () => ok("solutioneva.com", "solutioneva.com"));
  it("lower-cases and trims", () => ok("  SolutionEva.COM  ", "solutioneva.com"));
  it("drops a pasted scheme and trailing slash", () =>
    ok("https://solutioneva.com/", "solutioneva.com"));
  it("drops the fully-qualified trailing dot", () => ok("solutioneva.com.", "solutioneva.com"));
  it("takes a deeper name — a partner may delegate a whole sub-zone to us by hand", () =>
    ok("clients.solutioneva.com", "clients.solutioneva.com"));
  it("takes a hyphenated label", () => ok("solution-eva.ch", "solution-eva.ch"));
  it("takes a punycode IDN", () => ok("xn--80ak6aa92e.xn--p1ai", "xn--80ak6aa92e.xn--p1ai"));
  it("takes a two-part registry name that is NOT bare", () => ok("acme.co.uk", "acme.co.uk"));
});

describe("normalizeBaseDomain — refused", () => {
  it("empty", () => rejected("   ", "empty"));
  it("empty after a scheme alone", () => rejected("https://", "empty"));
  it("over 253 characters", () => rejected(`${"a".repeat(250)}.com`, "tooLong"));
  it("a single label", () => rejected("localdomain", "singleLabel"));
  it("a label over 63 characters", () => rejected(`${"a".repeat(64)}.com`, "notAHostname"));
  it("an empty label (double dot)", () => rejected("a..com", "notAHostname"));
  it("a leading hyphen", () => rejected("-eva.com", "notAHostname"));
  it("a trailing hyphen", () => rejected("eva-.com", "notAHostname"));
  it("an underscore", () => rejected("solution_eva.com", "notAHostname"));
  it("a port", () => rejected("solutioneva.com:8443", "notAHostname"));
  it("a path", () => rejected("solutioneva.com/clients/x", "notAHostname"));
  it("credentials", () => rejected("user@solutioneva.com", "notAHostname"));
  it("a wildcard", () => rejected("*.solutioneva.com", "notAHostname"));
  it("non-ASCII (we do not punycode it ourselves)", () => rejected("solutionéva.com", "notAHostname"));
  it("a single-character TLD", () => rejected("eva.c", "notAHostname"));
  it("a numeric TLD", () => rejected("eva.123", "notAHostname"));
  it("a dotted quad", () => rejected("192.168.1.1", "ipAddress"));
});

describe("normalizeBaseDomain — the refusals that are the point", () => {
  it("refuses our own zone", () => rejected("sofrapiwas.com", "ourZone"));
  it("refuses a subdomain of our own zone", () => rejected("obresse.sofrapiwas.com", "ourZone"));
  it("refuses the placeholder SaaS zone too", () =>
    rejected("staging.fooderist.com", "ourZone"));
  it("does NOT refuse a name that merely ENDS in the same letters", () =>
    ok("notsofrapiwas.com", "notsofrapiwas.com"));
  it("refuses a special-use TLD — no public certificate could ever be issued", () =>
    rejected("restaurant.local", "reservedTld"));
  it("refuses .test", () => rejected("e2e.test", "reservedTld"));
  it("refuses .internal", () => rejected("box.internal", "reservedTld"));
  it("refuses a bare registry suffix", () => rejected("co.uk", "publicSuffix"));
  it("refuses a bare registry suffix, pasted with a scheme", () =>
    rejected("https://com.tr/", "publicSuffix"));
});

describe("tenantHostname", () => {
  it("is exactly slug + base, with nothing invented", () =>
    expect(tenantHostname("obresse", "solutioneva.com")).toBe("obresse.solutioneva.com"));
  it("works under a deeper base", () =>
    expect(tenantHostname("obresse", "clients.solutioneva.com")).toBe(
      "obresse.clients.solutioneva.com",
    ));
});
