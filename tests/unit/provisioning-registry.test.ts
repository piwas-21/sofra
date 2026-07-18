import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildTenantRegistryEntry } from "@/lib/provisioning-registry";

// Parse a generated block back through the registry shape it will live in.
const asTenant = (block: string, slug: string) =>
  (parse(`version: 1\ntenants:\n${block}`) as { tenants: Record<string, unknown> }).tenants[slug];

describe("buildTenantRegistryEntry", () => {
  it("derives slug-based fields and defaults status/managed/box", () => {
    const block = buildTenantRegistryEntry({
      slug: "bistro-nova",
      name: "Bistro Nova",
      adminEmail: "owner@nova.example",
      template: "craft",
      currency: "EUR",
      languages: ["en", "nl"],
      modules: ["core"],
      city: "Rotterdam",
    });
    expect(asTenant(block, "bistro-nova")).toEqual({
      name: "Bistro Nova",
      status: "provisioning",
      managed: "scripts",
      box: "staging",
      domain: "bistro-nova.sofrapiwas.com",
      domain_mode: "subdomain",
      db: "tenant_bistro-nova",
      db_role: "tenant_bistro-nova",
      compose_project: "tenant-bistro-nova",
      backend_tag: "latest",
      frontend_tag: "tenant-bistro-nova",
      currency: "EUR",
      languages: ["en", "nl"],
      modules: ["core"],
      template: "craft",
      admin_email: "owner@nova.example",
      city: "Rotterdam",
    });
  });

  it("omits city when not provided and honours an explicit box", () => {
    const t = asTenant(
      buildTenantRegistryEntry({
        slug: "nocity",
        name: "No City",
        adminEmail: "a@b.co",
        template: "classic",
        currency: "CHF",
        languages: ["en"],
        modules: ["core"],
        box: "prod",
      }),
      "nocity",
    ) as Record<string, unknown>;
    expect(t.city).toBeUndefined();
    expect(t.box).toBe("prod");
    expect(t.template).toBe("classic");
  });

  it("escapes YAML-special characters in free-text (no injection)", () => {
    // A name with a colon + a would-be injected key must round-trip as a plain
    // string value, never as new YAML structure.
    const name = "Nova: Café\nmanaged: legacy";
    const t = asTenant(
      buildTenantRegistryEntry({
        slug: "evil",
        name,
        adminEmail: "a@b.co",
        template: "craft",
        currency: "EUR",
        languages: ["en"],
        modules: ["core"],
      }),
      "evil",
    ) as Record<string, unknown>;
    expect(t.name).toBe(name);
    expect(t.managed).toBe("scripts"); // the injected "managed: legacy" did NOT take effect
  });
});
