// What DNS a tenant's hostnames need before they can serve anything — as a
// *standing* fact about a registry entry, not as a one-off response to a form.
//
// WHY this exists. The partner-facing instruction already existed, in
// `ClientDomainOutcome`, and it was unreachable in the only situation that
// matters: it renders from `state.proposal`, the transient answer to submitting
// the domain chooser, and the chooser itself is hidden once `tenantSlug` is set.
// So a partner saw the record they had to publish exactly once, on one screen,
// before the tenant existed — a page reload erased it, and after provisioning
// there was no surface in the product that could tell them again. Measured
// 2026-08-21 on a live client (O'Bresse under solutioneva.com): the partner had
// claimed his zone, no A record existed, the tenant could not get a certificate,
// and nothing in his dashboard said so. He asked us in a meeting instead.
//
// This module answers the same question from the REGISTRY, which is durable, so
// the answer survives reloads and outlives provisioning.
//
// It deliberately mirrors `dns_record_advice()` in the deploy repo's
// provision-tenant.sh — same three branches, same "name" convention (the label
// for a partner zone, the whole hostname otherwise). Two places tell a human
// which record to publish; they must not disagree about what it is.
//
// Pure — no DNS, no env, no DB. Whether the record ALREADY resolves is a
// separate, fallible network question and lives in `tenant-dns-check.ts`.

import type { RegistryTenant } from "@/lib/tenant-registry";

/** Zones we answer for, where `*.<zone>` already resolves to the box. Kept in
 *  step with `OUR_ZONES` in base-domain.ts — that one guards what a partner may
 *  CLAIM, this one decides whether a record is needed at all. */
const WILDCARD_ZONES = ["sofrapiwas.com", "fooderist.com"] as const;

export interface TenantDnsRecord {
  /** The hostname guests will type. */
  host: string;
  type: "A";
  /** What goes in the zone editor's "name" box: the bare label when we know the
   *  zone the partner administers, the whole hostname otherwise. */
  name: string;
  /** The zone whose editor they must open. */
  zone: string;
  /** Who owns that zone, and therefore who has to act. We can ask, but we cannot
   *  publish it: a partner's company zone and a restaurant's own domain are both
   *  outside our control (there is no delegated sub-zone — see registry.yml). */
  publishedBy: "partner" | "restaurant";
  /** True when this host only redirects to the canonical one (`domain_aliases`).
   *  Its absence breaks old links and printed QR codes rather than the app, so it
   *  is worth showing and worth ranking below the real thing. */
  alias: boolean;
}

function underAWildcardZone(host: string): boolean {
  return WILDCARD_ZONES.some((z) => host === z || host.endsWith(`.${z}`));
}

/** The record ONE hostname needs, or null when our wildcard already answers. */
export function dnsRecordForHost(args: {
  host: string;
  baseDomain?: string;
  alias?: boolean;
}): TenantDnsRecord | null {
  const host = args.host.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  // Ours: the `*.sofrapiwas.com` wildcard answers already, and a per-tenant record
  // would be one more thing to get wrong for no gain.
  if (underAWildcardZone(host)) return null;

  const base = args.baseDomain?.trim().toLowerCase().replace(/\.$/, "");
  // A partner's zone: they publish one record per client, because there is no
  // wildcard on it and there cannot be one we control (registry.yml §base_domain).
  if (base && !underAWildcardZone(base) && host.endsWith(`.${base}`)) {
    return {
      host,
      type: "A",
      name: host.slice(0, -(base.length + 1)),
      zone: base,
      publishedBy: "partner",
      alias: args.alias ?? false,
    };
  }

  // Anything else is a name the RESTAURANT owns (`domain_mode: byo`), or an alias
  // on some third zone. We do not know where the zone cut is without a public-suffix
  // list, so we print the whole hostname — which every DNS editor accepts.
  return {
    host,
    type: "A",
    name: host,
    zone: host,
    publishedBy: "restaurant",
    alias: args.alias ?? false,
  };
}

/**
 * Every record a registry entry needs, canonical domain first, then aliases.
 *
 * Aliases are included because they fail the same way and are easier to forget:
 * the `www.` of a BYO apex, or an old host kept as a 301 so printed QR codes
 * survive a move. An empty array means "nothing to publish" — which is the normal,
 * happy case for a tenant on our own base domain.
 */
export function tenantDnsRecords(
  tenant: Pick<RegistryTenant, "domain" | "base_domain" | "domain_aliases">,
): TenantDnsRecord[] {
  const base = tenant.base_domain;
  const canonical = dnsRecordForHost({ host: tenant.domain, baseDomain: base });
  const aliases = (tenant.domain_aliases ?? [])
    .map((host) => dnsRecordForHost({ host, baseDomain: base, alias: true }))
    .filter((r): r is TenantDnsRecord => r !== null);
  // De-duplicate: an alias repeating the canonical host is a registry typo, not a
  // second record, and showing it twice would read as two things to do.
  const seen = new Set<string>();
  return [...(canonical ? [canonical] : []), ...aliases].filter((r) => {
    if (seen.has(r.host)) return false;
    seen.add(r.host);
    return true;
  });
}
