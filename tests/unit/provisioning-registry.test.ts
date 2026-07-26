import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildProvisioningPrBody, buildTenantRegistryEntry } from "@/lib/provisioning-registry";

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

describe("buildProvisioningPrBody", () => {
  const input = {
    slug: "bistro-nova",
    name: "Bistro Nova",
    adminEmail: "owner@nova.example",
    template: "craft" as const,
    currency: "EUR",
    languages: ["en", "nl"],
    modules: ["core", "reservations"],
    city: "Rotterdam",
  };

  it("carries the post-merge commands with the tenant's own values", () => {
    const body = buildProvisioningPrBody(input);
    // The image build is the step that is easy to skip and fatal to skip.
    expect(body).toContain(
      "gh workflow run build-tenant-image.yml --repo piwas-21/restaurant-app-frontend",
    );
    expect(body).toContain("-f tenant_domain=bistro-nova.sofrapiwas.com");
    expect(body).toContain("-f image_tag=tenant-bistro-nova");
    expect(body).toContain("-f template=craft");
    expect(body).toContain("-f currency=EUR");
    expect(body).toContain(
      "gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=bistro-nova",
    );
    // Ordering is the point: build the image before provisioning.
    expect(body.indexOf("build-tenant-image.yml")).toBeLessThan(
      body.indexOf("provision-tenant.yml"),
    );
  });

  it("summarises the proposed entry", () => {
    const body = buildProvisioningPrBody(input);
    expect(body).toContain("`bistro-nova.sofrapiwas.com`");
    expect(body).toContain("`en, nl`");
    expect(body).toContain("`core, reservations`");
    expect(body).toContain("`staging`"); // default box
  });

  it("shell-quotes the tenant name so an apostrophe cannot break the command", () => {
    const body = buildProvisioningPrBody({ ...input, name: "Chez L'Ami; rm -rf /" });
    expect(body).toContain(`-f restaurant_name='Chez L'\\''Ami; rm -rf /'`);
    // No bare, unquoted occurrence that a shell would split or execute.
    expect(body).not.toContain("-f restaurant_name=Chez");
  });
});
