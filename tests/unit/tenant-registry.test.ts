import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTenantRegistry } from "@/lib/tenant-registry";

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
      expect(res.tenants.map((t) => t.slug)).toEqual(["demo", "rumi"]); // sorted
      const rumi = res.tenants.find((t) => t.slug === "rumi")!;
      expect(rumi.name).toBe("Rumi Restaurant");
      expect(rumi.languages).toHaveLength(10);
      // template parses when present (frontend ADR-006 enum)
      expect(rumi.template).toBe("craft");
      // optional fields absent on demo default to []
      const demo = res.tenants.find((t) => t.slug === "demo")!;
      expect(demo.modules).toEqual([]);
      expect(demo.currency).toBeUndefined();
      // template is optional — pre-T2 entries stay parseable, no baked default
      expect(demo.template).toBeUndefined();
    }
  });

  it("returns ok:false when a template value is outside classic|craft", async () => {
    process.env.TENANT_REGISTRY_PATH = fixture("registry-bad-template.yml");
    const res = await loadTenantRegistry();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/template/);
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
