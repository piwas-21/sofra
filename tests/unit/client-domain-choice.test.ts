import { describe, expect, it } from "vitest";
import {
  DOMAIN_CHOICES,
  isDomainChoice,
  proposalNoteBody,
  resolveDomainProposal,
} from "@/lib/client-domain-choice";

// Which of the four domain shapes a partner proposed, and what DNS it needs
// (SOFRA-PARTNER-FLEXIBILITY-PLAN D2).
//
// The two properties that matter most here are refusals, not successes: the fourth
// option must be refused on the SERVER (a disabled radio is a client-side fact), and
// option 2 must be unreachable without a base domain the caller has already proven
// belongs to this partner.

const base = { slug: "obresse" };
const proposalOf = (input: Parameters<typeof resolveDomainProposal>[0]) => {
  const r = resolveDomainProposal(input);
  if (!r.ok) throw new Error(`expected a proposal, got ${r.reason}`);
  return r.proposal;
};
const rejectionOf = (input: Parameters<typeof resolveDomainProposal>[0]) => {
  const r = resolveDomainProposal(input);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
};

describe("isDomainChoice", () => {
  it("accepts every declared choice", () =>
    expect(DOMAIN_CHOICES.every(isDomainChoice)).toBe(true));
  it("refuses anything else", () => expect(isDomainChoice("wildcard")).toBe(false));
});

describe("option 1 — ours, the default", () => {
  it("derives the hostname and needs no DNS at all", () => {
    expect(proposalOf({ ...base, choice: "sofra" })).toEqual({
      choice: "sofra",
      domain: "obresse.sofrapiwas.com",
      domainMode: "subdomain",
      // The wildcard already answers — this is why option 1 costs the partner nothing.
      requiredRecord: null,
      publishedBy: "sofra",
    });
  });
});

describe("option 2 — the partner's own zone", () => {
  it("derives <slug>.<base> and names the record the PARTNER must publish", () => {
    expect(
      proposalOf({ ...base, choice: "partnerBase", verifiedBaseDomain: "solutioneva.com" }),
    ).toEqual({
      choice: "partnerBase",
      domain: "obresse.solutioneva.com",
      domainMode: "subdomain",
      baseDomain: "solutioneva.com",
      requiredRecord: { type: "A", name: "obresse.solutioneva.com" },
      publishedBy: "partner",
    });
  });

  it("REFUSES when no base domain was supplied — the caller either had none verified or did not look", () =>
    expect(rejectionOf({ ...base, choice: "partnerBase" })).toBe("noBaseDomain"));
});

describe("option 3 — the restaurant's own domain", () => {
  it("is byo, with the record the RESTAURANT must publish", () => {
    expect(proposalOf({ ...base, choice: "byo", ownDomain: "thebistro.ch" })).toEqual({
      choice: "byo",
      domain: "thebistro.ch",
      domainMode: "byo",
      requiredRecord: { type: "A", name: "thebistro.ch" },
      publishedBy: "restaurant",
    });
  });

  it("normalizes a pasted URL, so the registry never carries a scheme", () =>
    expect(proposalOf({ ...base, choice: "byo", ownDomain: " HTTPS://TheBistro.ch/ " }).domain).toBe(
      "thebistro.ch",
    ));

  it("refuses a missing domain", () =>
    expect(rejectionOf({ ...base, choice: "byo" })).toBe("invalidOwnDomain"));

  it("refuses nonsense", () =>
    expect(rejectionOf({ ...base, choice: "byo", ownDomain: "not a domain" })).toBe(
      "invalidOwnDomain",
    ));

  // A `byo` entry for our own zone would be a SECOND, non-canonical origin for a name
  // the wildcard already serves — one canonical origin, or the tenant's app makes
  // cross-origin API calls (plan §D1c).
  it("refuses one of OUR addresses, with its own reason", () =>
    expect(rejectionOf({ ...base, choice: "byo", ownDomain: "obresse.sofrapiwas.com" })).toBe(
      "ownDomainIsOurs",
    ));
});

describe("option 4 — buy through us", () => {
  it("is refused on the SERVER, not merely hidden in the UI", () =>
    expect(rejectionOf({ ...base, choice: "buy" })).toBe("buyUnavailable"));
});

describe("the slug is judged before anything else", () => {
  it("refuses a malformed one", () =>
    expect(rejectionOf({ choice: "sofra", slug: "Obresse!" })).toBe("invalidSlug"));

  // Reserved matters MORE under a partner's zone, not less: `mail.solutioneva.com`
  // would take over a name their own company already depends on.
  it("refuses a reserved one, even under a partner's own zone", () =>
    expect(
      rejectionOf({ choice: "partnerBase", slug: "mail", verifiedBaseDomain: "solutioneva.com" }),
    ).toBe("reservedSlug"));

  // The registry KEY is the slug whatever the domain is, so two tenants under
  // different zones still cannot share one.
  it("refuses one already in the registry, whichever zone it is proposed for", () => {
    for (const choice of ["sofra", "partnerBase"] as const) {
      expect(
        rejectionOf({
          choice,
          slug: "obresse",
          verifiedBaseDomain: "solutioneva.com",
          takenSlugs: ["rumi", "obresse"],
        }),
      ).toBe("takenSlug");
    }
  });

  it("refuses an unknown choice before it can be read as a default", () =>
    expect(rejectionOf({ ...base, choice: "wildcard" })).toBe("unknownChoice"));
});

describe("proposalNoteBody", () => {
  it("is the registry's own field names, not a sentence — the founder transcribes it", () =>
    expect(
      proposalNoteBody(
        proposalOf({ ...base, choice: "partnerBase", verifiedBaseDomain: "solutioneva.com" }),
      ),
    ).toBe(
      [
        "domain: obresse.solutioneva.com",
        "domain_mode: subdomain",
        "base_domain: solutioneva.com",
        "dns: A obresse.solutioneva.com -> box",
      ].join("\n"),
    ));

  it("omits base_domain and the DNS line when neither applies", () =>
    expect(proposalNoteBody(proposalOf({ ...base, choice: "sofra" }))).toBe(
      ["domain: obresse.sofrapiwas.com", "domain_mode: subdomain"].join("\n"),
    ));

  it("carries the byo mode", () =>
    expect(proposalNoteBody(proposalOf({ ...base, choice: "byo", ownDomain: "thebistro.ch" }))).toBe(
      ["domain: thebistro.ch", "domain_mode: byo", "dns: A thebistro.ch -> box"].join("\n"),
    ));
});
