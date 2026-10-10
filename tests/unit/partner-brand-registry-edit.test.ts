import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  AmbiguousPartnerBrandRegistryError,
  IneligiblePartnerBrandTenantError,
  UnknownPartnerBrandTenantError,
  partnerBrandTenantState,
  setRegistryPartnerBrand,
} from "@/lib/partner-brand-registry-edit";

const source = (extra = "") =>
  [
    "# Hand-maintained registry header comment stays byte-for-byte.",
    "version: 1",
    "tenants:",
    "  cafe-demo:",
    "    name: Cafe Demo",
    "    status: active # active tenants may be updated",
    "    managed: scripts",
    "    domain: cafe-demo.sofrapiwas.com",
    "    partner_attribution: true",
    extra,
    "    modules: [core, reservations]",
    "  other-demo:",
    "    name: Other Demo",
    "    status: active",
    "    managed: scripts",
    "    partner_name: Preserve Me",
  ]
    .filter(Boolean)
    .join("\n") + "\n";

const brand = { displayName: "Cafe: # & \"Friends\"", websiteUrl: "https://cafe.example/about#team" };

describe("partner brand registry edit", () => {
  it("updates only the selected active script-managed block and safely quotes special strings", () => {
    const input = source("    notes: keep this unrelated field");
    const result = setRegistryPartnerBrand(input, "cafe-demo", brand);
    const parsed = parse(result.yaml) as { tenants: Record<string, Record<string, unknown>> };

    expect(result.changed).toBe(true);
    expect(parsed.tenants["cafe-demo"]).toMatchObject({
      partner_name: brand.displayName,
      partner_url: brand.websiteUrl,
      partner_attribution: true,
      notes: "keep this unrelated field",
    });
    expect(parsed.tenants["cafe-demo"]).not.toHaveProperty("evil");
    expect(parsed.tenants["other-demo"].partner_name).toBe("Preserve Me");
    expect(result.yaml).toContain("# Hand-maintained registry header comment stays byte-for-byte.");
  });

  it("does not churn the file when the exact requested projection is already present", () => {
    const input = setRegistryPartnerBrand(source(), "cafe-demo", brand).yaml;
    expect(setRegistryPartnerBrand(input, "cafe-demo", brand)).toEqual({
      yaml: input,
      changed: false,
      optedOut: false,
    });
  });

  it("removes prior public keys for unpublish while preserving restaurant opt-out", () => {
    const input = source().replace("    partner_attribution: true", "    partner_attribution: false # restaurant choice");
    const published = setRegistryPartnerBrand(input, "cafe-demo", brand);
    const removed = setRegistryPartnerBrand(published.yaml, "cafe-demo", null);
    const parsed = parse(removed.yaml) as { tenants: Record<string, Record<string, unknown>> };

    expect(published.optedOut).toBe(true);
    expect(removed.changed).toBe(false);
    expect(parsed.tenants["cafe-demo"].partner_attribution).toBe(false);
    expect(parsed.tenants["cafe-demo"]).not.toHaveProperty("partner_name");
    expect(parsed.tenants["cafe-demo"]).not.toHaveProperty("partner_url");
    expect(parsed.tenants["other-demo"].partner_name).toBe("Preserve Me");
    expect(removed.yaml).toContain("partner_attribution: false # restaurant choice");
  });

  it("removes old public keys when the restaurant opts out after a prior publish", () => {
    const published = setRegistryPartnerBrand(source(), "cafe-demo", brand);
    const optedOut = published.yaml.replace("partner_attribution: true", 'partner_attribution: "false"');

    const result = setRegistryPartnerBrand(optedOut, "cafe-demo", brand);
    const parsed = parse(result.yaml) as { tenants: Record<string, Record<string, unknown>> };

    expect(result.changed).toBe(true);
    expect(result.optedOut).toBe(true);
    expect(parsed.tenants["cafe-demo"]).not.toHaveProperty("partner_name");
    expect(parsed.tenants["cafe-demo"]).not.toHaveProperty("partner_url");
    expect(parsed.tenants["cafe-demo"].partner_attribution).toBe("false");
  });

  it("preserves comments and unrelated fields when existing URL precedes name during replacement or removal", () => {
    const extra = [
      '    partner_url: "https://old.example"',
      "    # Preserve this comment while replacing or removing public fields.",
      "    notes: keep this unrelated field # preserve the inline comment",
      '    partner_name: "Old Partner"',
    ].join("\n");
    const input = source(extra);
    const withoutPublicFields = (yaml: string) =>
      yaml
        .split("\n")
        .filter((line) => !/^ {4}partner_(?:name|url):/.test(line))
        .join("\n");

    const replaced = setRegistryPartnerBrand(input, "cafe-demo", brand);
    const replacedParsed = parse(replaced.yaml) as { tenants: Record<string, Record<string, unknown>> };
    expect(replaced.changed).toBe(true);
    expect(replacedParsed.tenants["cafe-demo"]).toMatchObject({
      partner_name: brand.displayName,
      partner_url: brand.websiteUrl,
      notes: "keep this unrelated field",
    });
    expect(withoutPublicFields(replaced.yaml)).toBe(withoutPublicFields(input));

    const removed = setRegistryPartnerBrand(input, "cafe-demo", null);
    const removedParsed = parse(removed.yaml) as { tenants: Record<string, Record<string, unknown>> };
    expect(removed.changed).toBe(true);
    expect(removedParsed.tenants["cafe-demo"]).not.toHaveProperty("partner_name");
    expect(removedParsed.tenants["cafe-demo"]).not.toHaveProperty("partner_url");
    expect(removedParsed.tenants["cafe-demo"].notes).toBe("keep this unrelated field");
    expect(withoutPublicFields(removed.yaml)).toBe(withoutPublicFields(input));
    expect(removedParsed.tenants["other-demo"].partner_name).toBe("Preserve Me");
  });

  it("rejects target blocks with YAML merges or anchors instead of guessing inherited attribution", () => {
    const merged = source().replace("    partner_attribution: true\n", "    <<: *restaurant-policy\n");
    const anchored = source().replace("    partner_attribution: true", "    partner_attribution: &allowAttribution true");

    expect(() => setRegistryPartnerBrand(merged, "cafe-demo", brand)).toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => partnerBrandTenantState(merged, "cafe-demo")).toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(anchored, "cafe-demo", brand)).toThrow(AmbiguousPartnerBrandRegistryError);
  });

  it("treats a quoted false as opt-out and never replaces it with true", () => {
    const input = source().replace("partner_attribution: true", 'partner_attribution: "false"');
    expect(partnerBrandTenantState(input, "cafe-demo")).toEqual({ eligible: true, optedOut: true });
    const result = setRegistryPartnerBrand(input, "cafe-demo", brand);
    expect(result.optedOut).toBe(true);
    expect(result.yaml).toContain('partner_attribution: "false"');
    const parsed = parse(result.yaml) as { tenants: Record<string, Record<string, unknown>> };
    expect(parsed.tenants["cafe-demo"]).not.toHaveProperty("partner_name");
  });

  it("rejects unsafe display names and non-HTTPS websites", () => {
    for (const displayName of ["", " ", "A".repeat(81), "Name\nInjected: true"]) {
      expect(() => setRegistryPartnerBrand(source(), "cafe-demo", { displayName, websiteUrl: undefined }))
        .toThrow(AmbiguousPartnerBrandRegistryError);
    }
    expect(() => setRegistryPartnerBrand(source(), "cafe-demo", {
      displayName: "Public Partner",
      websiteUrl: "http://partner.example",
    })).toThrow(AmbiguousPartnerBrandRegistryError);
  });

  it("rejects non-string existing public keys rather than overwriting ambiguous YAML", () => {
    expect(() => setRegistryPartnerBrand(source("    partner_name: false"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(source("    partner_url: false"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
  });

  it("rejects unknown, duplicate, malformed, inactive, and legacy targets", () => {
    expect(() => setRegistryPartnerBrand(source(), "missing", brand)).toThrow(UnknownPartnerBrandTenantError);
    expect(() => partnerBrandTenantState(source(), "missing")).toThrow(UnknownPartnerBrandTenantError);
    expect(() => setRegistryPartnerBrand(source().replace("  other-demo:", "  cafe-demo:\n  other-demo:"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(source().replace("partner_attribution: true", "partner_attribution: maybe"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(source().replace("partner_attribution: true", "partner_attribution:"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(source().replace("partner_attribution: true", "partner_attribution: |"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(source().replace("partner_attribution: true", "partner_attribution: ["), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
    expect(() => setRegistryPartnerBrand(source().replace("    managed: scripts", "    managed: legacy"), "cafe-demo", brand))
      .toThrow(IneligiblePartnerBrandTenantError);
    expect(() => setRegistryPartnerBrand(source().replace("    status: active # active tenants may be updated", "    status: paused"), "cafe-demo", brand))
      .toThrow(IneligiblePartnerBrandTenantError);
    expect(() => setRegistryPartnerBrand(source().replace("    partner_attribution: true", "    partner_name: One\n    partner_name: Two\n    partner_attribution: true"), "cafe-demo", brand))
      .toThrow(AmbiguousPartnerBrandRegistryError);
  });
});
