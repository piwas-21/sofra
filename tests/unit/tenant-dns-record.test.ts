import { describe, expect, it } from "vitest";
import { dnsRecordForHost, tenantDnsRecords } from "@/lib/tenant-dns-record";

// The question this module answers is "what does a human still have to publish?", and
// getting it wrong is expensive in both directions: a record we fail to ask for leaves
// a tenant permanently without a certificate (the O'Bresse failure this was written
// for), and a record we ask for needlessly sends a partner into a zone editor to break
// something that already worked.

const entry = (over: Partial<Parameters<typeof tenantDnsRecords>[0]> = {}) => ({
  domain: "obresse.solutioneva.com",
  base_domain: "solutioneva.com",
  domain_aliases: [] as string[],
  ...over,
});

describe("tenantDnsRecords — our own base domain needs nothing", () => {
  it("returns no records for a *.sofrapiwas.com tenant (the wildcard answers)", () => {
    expect(tenantDnsRecords(entry({ domain: "demo.sofrapiwas.com", base_domain: undefined })))
      .toEqual([]);
  });

  it("covers fooderist.com too, which is ours until the cutover", () => {
    expect(tenantDnsRecords(entry({ domain: "x.staging.fooderist.com", base_domain: undefined })))
      .toEqual([]);
  });
});

describe("tenantDnsRecords — a partner zone needs one record per client", () => {
  it("asks the PARTNER for the bare label in his own zone", () => {
    expect(tenantDnsRecords(entry())).toEqual([
      {
        host: "obresse.solutioneva.com",
        type: "A",
        name: "obresse",
        zone: "solutioneva.com",
        publishedBy: "partner",
        alias: false,
      },
    ]);
  });

  it("does not ask for an alias that rides our wildcard — the old address after a move", () => {
    const records = tenantDnsRecords(entry({ domain_aliases: ["obresse.sofrapiwas.com"] }));
    expect(records.map((r) => r.host)).toEqual(["obresse.solutioneva.com"]);
  });
});

describe("tenantDnsRecords — a domain the restaurant owns", () => {
  it("asks for the WHOLE hostname, since we cannot know where their zone is cut", () => {
    expect(
      tenantDnsRecords({ domain: "www.rumirestaurant.ch", base_domain: undefined, domain_aliases: [] }),
    ).toEqual([
      {
        host: "www.rumirestaurant.ch",
        type: "A",
        name: "www.rumirestaurant.ch",
        zone: "www.rumirestaurant.ch",
        publishedBy: "restaurant",
        alias: false,
      },
    ]);
  });

  it("lists the apex alias as its own record — each alias needs its own A", () => {
    const records = tenantDnsRecords({
      domain: "www.thebistro.ch",
      base_domain: undefined,
      domain_aliases: ["thebistro.ch"],
    });
    expect(records.map((r) => [r.host, r.alias])).toEqual([
      ["www.thebistro.ch", false],
      ["thebistro.ch", true],
    ]);
  });
});

describe("tenantDnsRecords — defensive", () => {
  it("never lists the same host twice, even if an alias repeats the domain", () => {
    const records = tenantDnsRecords(entry({ domain_aliases: ["obresse.solutioneva.com"] }));
    expect(records).toHaveLength(1);
  });

  it("falls back to the restaurant branch when the host is not under its declared base", () => {
    // A mislabelled entry. provision-tenant.sh refuses this pair outright; here the
    // safe reading is "somebody else's zone", which asks for a record that WOULD work
    // rather than inventing a label under the wrong domain.
    const [record] = tenantDnsRecords(entry({ domain: "obresse.example.org" }));
    expect(record).toMatchObject({ name: "obresse.example.org", publishedBy: "restaurant" });
  });

  it("normalises case and a trailing dot before deciding", () => {
    expect(dnsRecordForHost({ host: "Obresse.SolutionEva.com.", baseDomain: "solutioneva.com" }))
      .toMatchObject({ host: "obresse.solutioneva.com", name: "obresse" });
  });

  it("ignores an empty hostname rather than asking for a record named nothing", () => {
    expect(dnsRecordForHost({ host: "   " })).toBeNull();
  });
});
