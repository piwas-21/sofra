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
      backend_tag: "staging",
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
    // A prod-box tenant rides :latest...
    expect(t.backend_tag).toBe("latest");
  });

  it("pins a staging-box tenant to :staging, not :latest", () => {
    // ...while :latest means main/prod, so a staging tenant pinned to it would
    // silently run production code instead of the develop build it showcases.
    const t = asTenant(
      buildTenantRegistryEntry({
        slug: "onstaging",
        name: "On Staging",
        adminEmail: "a@b.co",
        template: "craft",
        currency: "EUR",
        languages: ["en"],
        modules: ["core"],
      }),
      "onstaging",
    ) as Record<string, unknown>;
    expect(t.box).toBe("staging"); // the default
    expect(t.backend_tag).toBe("staging");
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

  it("tells a STAGING entry that merging provisions it", () => {
    const body = buildProvisioningPrBody(input);
    expect(body).toContain("Merging this PR provisions the tenant");
    // The slug is the one field that cannot be renegotiated afterwards, so the
    // checklist has to name the actual value rather than talk about slugs.
    expect(body).toContain("`bistro-nova` is what the customer should live on forever");
    expect(body).toContain("### If the chain fails");
  });

  it("tells a PROD entry the opposite, because the chain is staging-only", () => {
    // The chain follows sync-registry-to-staging and skips any other box. A prod body
    // promising hands-off provisioning would leave the founder waiting on nothing.
    const body = buildProvisioningPrBody({ ...input, box: "prod" });
    expect(body).toContain("does **not** provision");
    expect(body).not.toContain("Merging this PR provisions the tenant");
    expect(body).not.toContain("hands-off");
    // ...and the commands stop being a fallback.
    expect(body).toContain("### Run these after merging");
  });

  it("flags the backend_tag risk that actually exists for each box", () => {
    // buildTenantRegistryEntry pins backend_tag FROM the box, so "a staging tenant might
    // be on :latest" is impossible by construction — warning about it would be an
    // unfalsifiable checkbox on every real PR. The live risk is the reverse: a staging-box
    // tenant rides the develop build, which is wrong for someone paying.
    const staging = buildProvisioningPrBody(input);
    expect(staging).toContain("rides the *develop* build");
    expect(staging).toContain("unreleased backend code");
    expect(staging).not.toContain("staging-box tenant on `:latest`");

    const prod = buildProvisioningPrBody({ ...input, box: "prod" });
    expect(prod).toContain("released code");
    expect(prod).not.toContain("unreleased backend code");
  });

  it("keeps a newline in the tenant name from breaking the fence or the command", () => {
    // provisionSchema refuses control characters, but this body is a pure function that
    // embeds `name` inside a ``` fence AND a shell command. An interior newline would
    // close the fence early, render the rest as prose, and hand the founder a command
    // with an unterminated quote.
    const body = buildProvisioningPrBody({ ...input, name: "Bistro\n```\n## PWNED" });
    const lines = body.split("\n");
    // Markdown only closes a fence at the START of a line, so counting every ``` in the
    // document would fail on a harmless mid-line one. The invariant that matters is that
    // the fence delimiters are exactly the two we wrote.
    expect(lines.filter((l) => l.trimStart().startsWith("```"))).toEqual(["```bash", "```"]);
    // ...and the whole command stays on one line, so it is still copy-pasteable.
    expect(lines.filter((l) => l.includes("-f restaurant_name="))).toEqual([
      "  -f restaurant_name='Bistro ``` ## PWNED' \\",
    ]);
  });

  it("shell-quotes the tenant name so an apostrophe cannot break the command", () => {
    const body = buildProvisioningPrBody({ ...input, name: "Chez L'Ami; rm -rf /" });
    expect(body).toContain(`-f restaurant_name='Chez L'\\''Ami; rm -rf /'`);
    // No bare, unquoted occurrence that a shell would split or execute.
    expect(body).not.toContain("-f restaurant_name=Chez");
  });
});
