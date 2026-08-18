import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTenantRegistry, missingPairedStripeAccount } from "@/lib/tenant-registry";

// loadTenantRegistry reads TENANT_REGISTRY_PATH and never throws — it returns
// a result union. Point the env var at fixtures per case.
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("loadTenantRegistry", () => {
  const original = process.env.TENANT_REGISTRY_PATH;
  beforeEach(() => {
    delete process.env.TENANT_REGISTRY_PATH;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.TENANT_REGISTRY_PATH;
    else process.env.TENANT_REGISTRY_PATH = original;
  });

  it("returns ok:false when the env var is unset", async () => {
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/TENANT_REGISTRY_PATH/);
  });

  it("loads and validates a well-formed registry, sorted by slug", async () => {
    process.env.TENANT_REGISTRY_PATH = fixture("registry-valid.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tenants.map((t) => t.slug)).toEqual(["demo", "pays", "rumi", "unpaired"]); // sorted
      const rumi = res.tenants.find((t) => t.slug === "rumi")!;
      expect(rumi.name).toBe("Rumi Restaurant");
      expect(rumi.languages).toHaveLength(10);
      // template parses when present (frontend ADR-006 enum)
      expect(rumi.template).toBe("craft");
      // live_since parses as a plain YYYY-MM-DD string when present
      expect(rumi.live_since).toBe("2026-06-29");
      // optional fields absent on demo default to []
      const demo = res.tenants.find((t) => t.slug === "demo")!;
      expect(demo.modules).toEqual([]);
      expect(demo.currency).toBeUndefined();
      // template is optional — pre-T2 entries stay parseable, no baked default
      expect(demo.template).toBeUndefined();
      // live_since is optional — absent entries stay parseable
      expect(demo.live_since).toBeUndefined();
    }
  });

  it("surfaces stripe_account, which zod silently stripped before P3", async () => {
    // The regression this guards is invisible by inspection: the key IS in
    // registry.yml and IS read by provision-tenant.sh, so the page looked
    // correct while rendering a field the parse had already deleted. Drop the
    // schema line and this is the test that fails.
    process.env.TENANT_REGISTRY_PATH = fixture("registry-valid.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tenants.find((t) => t.slug === "pays")!.stripe_account).toBe("acct_1PaysExample");
      // Optional — every tenant that never bought the module has none.
      expect(res.tenants.find((t) => t.slug === "rumi")!.stripe_account).toBeUndefined();
    }
  });

  it("returns ok:false when a template value is outside classic|craft", async () => {
    process.env.TENANT_REGISTRY_PATH = fixture("registry-bad-template.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/template/);
  });

  it("returns ok:false when live_since is an impossible calendar date", async () => {
    // 2026-02-31 passes the YYYY-MM-DD regex but is not a real day — the
    // round-trip refine must reject it (new Date would roll it over to Mar 3).
    process.env.TENANT_REGISTRY_PATH = fixture("registry-bad-livesince.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/live_since/);
  });

  it("returns ok:false (not a throw) on a schema-invalid file", async () => {
    process.env.TENANT_REGISTRY_PATH = fixture("registry-invalid.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(false);
  });

  it("returns ok:false (not a throw) when the file is missing", async () => {
    process.env.TENANT_REGISTRY_PATH = fixture("does-not-exist.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(false);
  });
});

describe("missingPairedStripeAccount", () => {
  const fromFixture = async (slug: string) => {
    process.env.TENANT_REGISTRY_PATH = fixture("registry-valid.yml");
    const res = await loadTenantRegistry();
    if (!res.ok) throw new Error(res.error);
    return res.tenants.find((t) => t.slug === slug)!;
  };
  const original = process.env.TENANT_REGISTRY_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.TENANT_REGISTRY_PATH;
    else process.env.TENANT_REGISTRY_PATH = original;
  });

  it("flags a real registry entry that bought the module with no account", async () => {
    // Driven from the fixture rather than a hand-built object, so the flag is
    // proven against the shape that actually survives the parse.
    expect(missingPairedStripeAccount(await fromFixture("unpaired"))).toBe(true);
  });

  it("does not flag the same modules once the account is there", async () => {
    expect(missingPairedStripeAccount(await fromFixture("pays"))).toBe(false);
  });

  it("does not flag a tenant that never bought an account-paired module", async () => {
    expect(missingPairedStripeAccount(await fromFixture("rumi"))).toBe(false);
    // …not even one with no modules at all (demo's list defaults to []).
    expect(missingPairedStripeAccount(await fromFixture("demo"))).toBe(false);
  });

  it("treats a whitespace-only account as absent, exactly as the box does", () => {
    // `provision-tenant.sh` tests `-z "$STRIPE_ACCOUNT"`, which " " does NOT
    // satisfy — so a stray space is an entry that provisions and then refuses.
    // Rendering it as configured would hide the one case the page exists for.
    expect(
      missingPairedStripeAccount({ modules: ["online-payments"], stripe_account: "   " }),
    ).toBe(true);
    expect(missingPairedStripeAccount({ modules: ["online-payments"], stripe_account: "" })).toBe(
      true,
    );
  });
});
