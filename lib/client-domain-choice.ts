// Where a reseller's restaurant will live, as the partner PROPOSES it
// (SOFRA-PARTNER-FLEXIBILITY-PLAN D2).
//
// Four shapes were on the table; three of them exist:
//
//   1. `<slug>.sofrapiwas.com`      — ours, zero setup, the default
//   2. `<slug>.<partner base>`      — D1's verified zone (`obresse.solutioneva.com`)
//   3. the restaurant's own domain  — the `byo` path provision-tenant.sh already runs
//   4. buy one through us           — DESIGNED, BLOCKED, and deliberately not offered
//
// (4) is blocked on domainio#231: `activateDNS` passes `domain-name` where
// ResellerClub's `dns/activate.json` needs `order-id`, so a freshly registered domain
// cannot receive DNS records through the API at all. Selling it today would end with a
// domain we own and cannot point anywhere — the worst possible half-state to sell. It
// is refused here as well as hidden in the UI, because a disabled radio is a client-side
// fact and this is the server's answer.
//
// The partner PROPOSES; the founder still merges the registry PR (ADR-003/007). Nothing
// in this module writes anything — it turns a form into a validated proposal, and the
// action turns that into a note, a mail and an audit row.
//
// Pure — no DB, no network, no env — so every refusal below is a unit test. In
// particular it CANNOT tell whether a base domain is verified or whose it is: the caller
// loads it scoped by `partnerId` and checks `verifiedAt` first, and passes it in only
// then. Keeping that out of here is deliberate — an authorization decision made in a
// pure helper is one that can be bypassed by calling the helper differently.

import { normalizeBaseDomain, tenantHostname } from "./base-domain";
import { checkSlug } from "./slug-availability";

/** The four options, as the form names them. */
export const DOMAIN_CHOICES = ["sofra", "partnerBase", "byo", "buy"] as const;
export type DomainChoice = (typeof DOMAIN_CHOICES)[number];

export function isDomainChoice(value: string): value is DomainChoice {
  return (DOMAIN_CHOICES as readonly string[]).includes(value);
}

/** Why a proposal was refused. Each is a `control.errors.domainChoice.*` key. */
export type DomainProposalRejection =
  | "unknownChoice"
  | "buyUnavailable"
  | "invalidSlug"
  | "reservedSlug"
  | "takenSlug"
  | "noBaseDomain"
  | "invalidOwnDomain"
  | "ownDomainIsOurs";

/** What the founder will be asked to merge, and what DNS has to exist first. */
export interface DomainProposal {
  choice: Exclude<DomainChoice, "buy">;
  /** The hostname the restaurant's guests will use. */
  domain: string;
  /** Registry `domain_mode:`. */
  domainMode: "subdomain" | "byo";
  /** Registry `base_domain:` — set only for choice 2. Absent means sofrapiwas.com,
   *  which is every entry that exists today. */
  baseDomain?: string;
  /** The record that must resolve to the box BEFORE provisioning, or null when the
   *  wildcard already covers it. Certificates are per-hostname over HTTP-01, so the
   *  name has to answer first — there is no way to pre-issue. */
  requiredRecord: { type: "A"; name: string } | null;
  /** Who has to publish it: the partner owns their own zone, the restaurant owns theirs. */
  publishedBy: "sofra" | "partner" | "restaurant";
}

export type DomainProposalResult =
  | { ok: true; proposal: DomainProposal }
  | { ok: false; reason: DomainProposalRejection };

export interface DomainProposalInput {
  choice: string;
  /** The desired registry key. It is the subdomain AND the database AND the compose
   *  project, so it is validated even for `byo`, where it is not part of the hostname. */
  slug: string;
  /** The partner's base domain — passed ONLY when the caller has loaded it scoped by
   *  `partnerId` and confirmed `verifiedAt` is set. */
  verifiedBaseDomain?: string;
  /** The restaurant's own domain, for `byo`. */
  ownDomain?: string;
  /** Slugs already in the registry. The key is the slug whatever the domain is, so two
   *  tenants under different base domains still cannot share one. */
  takenSlugs?: readonly string[];
}

/**
 * Turn a partner's choice into a proposal, or say why not.
 *
 * The slug is checked against the same `checkSlug` the founder's form uses — including
 * the RESERVED list, which matters more here rather than less: under our own zone a
 * reserved word collides with our infrastructure, but under a partner's zone
 * `mail.solutioneva.com` or `www.solutioneva.com` would take over a name their own
 * company already depends on.
 */
export function resolveDomainProposal(input: DomainProposalInput): DomainProposalResult {
  if (!isDomainChoice(input.choice)) return { ok: false, reason: "unknownChoice" };
  if (input.choice === "buy") return { ok: false, reason: "buyUnavailable" };

  const slug = input.slug.trim();
  const verdict = checkSlug(slug, input.takenSlugs ?? []);
  if (verdict === "invalid") return { ok: false, reason: "invalidSlug" };
  if (verdict === "reserved") return { ok: false, reason: "reservedSlug" };
  if (verdict === "taken") return { ok: false, reason: "takenSlug" };

  if (input.choice === "sofra") {
    return {
      ok: true,
      proposal: {
        choice: "sofra",
        domain: tenantHostname(slug, "sofrapiwas.com"),
        domainMode: "subdomain",
        // The wildcard `*.sofrapiwas.com` A record already answers for it — this is the
        // whole reason option 1 is the default and costs the partner nothing.
        requiredRecord: null,
        publishedBy: "sofra",
      },
    };
  }

  if (input.choice === "partnerBase") {
    const base = input.verifiedBaseDomain;
    // Absent means the caller either had no verified zone for this partner or did not
    // look. Both are "you cannot use this option yet", and neither may fall through.
    if (!base) return { ok: false, reason: "noBaseDomain" };
    const domain = tenantHostname(slug, base);
    return {
      ok: true,
      proposal: {
        choice: "partnerBase",
        domain,
        domainMode: "subdomain",
        baseDomain: base,
        requiredRecord: { type: "A", name: domain },
        publishedBy: "partner",
      },
    };
  }

  // byo — the restaurant's own domain. Re-validated through the same normalizer the
  // base-domain claim uses, so a pasted URL is accepted and our own zone is refused
  // (a `byo` entry for `x.sofrapiwas.com` would be a second, non-canonical origin for
  // a name the wildcard already serves).
  const parsed = normalizeBaseDomain(input.ownDomain ?? "");
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason === "ourZone" ? "ownDomainIsOurs" : "invalidOwnDomain" };
  }
  return {
    ok: true,
    proposal: {
      choice: "byo",
      domain: parsed.domain,
      domainMode: "byo",
      requiredRecord: { type: "A", name: parsed.domain },
      publishedBy: "restaurant",
    },
  };
}

/**
 * The proposal as the founder will read it on the client's notes.
 *
 * Deliberately the REGISTRY'S OWN FIELD NAMES rather than a sentence. The note is
 * stored once and read by two people on two surfaces in six locales, so an English
 * sentence composed here would be an English sentence on a translated page (the same
 * reason `requestClientChangeAction` stores its body verbatim). Field names are
 * language-neutral, and they are also exactly what has to be typed into the registry —
 * the founder can transcribe rather than interpret.
 */
export function proposalNoteBody(proposal: DomainProposal): string {
  const lines = [
    `domain: ${proposal.domain}`,
    `domain_mode: ${proposal.domainMode}`,
    ...(proposal.baseDomain ? [`base_domain: ${proposal.baseDomain}`] : []),
    ...(proposal.requiredRecord
      ? [`dns: ${proposal.requiredRecord.type} ${proposal.requiredRecord.name} -> box`]
      : []),
  ];
  return lines.join("\n");
}
