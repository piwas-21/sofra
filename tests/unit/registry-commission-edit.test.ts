import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InvalidCommissionBpsError,
  MissingStripeAccountError,
  UnknownRegistryTenantError,
  currentRegistryCommissionBps,
  setRegistryCommissionBps,
} from "@/lib/registry-commission-edit";

// SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a. This is a LINE-EDITING module by design
// (module comment) — a YAML parse-and-restringify would delete every hand-written
// comment in the real registry — so every test below reads the fixture as TEXT,
// never through a YAML parser, the same discipline the module itself follows.

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/registry-valid.yml", import.meta.url));
const fixture = (): string => readFileSync(FIXTURE_PATH, "utf8");

/**
 * An INDEPENDENT block extractor — written from the same spec as
 * `lib/registry-commission-edit.ts` (header at 2 spaces, body blank-or-
 * indented->=4) but never calling into it. Used only to read the fixture back
 * for assertions, so a bug in the module under test isn't also baked into the
 * tool checking its output.
 */
function extractBlock(yaml: string, slug: string): string {
  const lines = yaml.split("\n");
  const headerRe = new RegExp(`^ {2}${slug}:\\s*$`);
  const start = lines.findIndex((line) => headerRe.test(line));
  if (start === -1) throw new Error(`fixture has no '${slug}' block`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "" || /^ {4,}/.test(lines[i])) continue;
    end = i;
    break;
  }
  return lines.slice(start, end).join("\n");
}

const ALL_SLUGS = ["rumi", "demo", "pays", "unpaired", "commissioned", "demo2"];

describe("currentRegistryCommissionBps", () => {
  it("reads an existing rate", () => {
    expect(currentRegistryCommissionBps(fixture(), "commissioned")).toBe(200);
  });

  it("is undefined when the key is absent — the same 'absent means 0' convention as the writer", () => {
    expect(currentRegistryCommissionBps(fixture(), "pays")).toBeUndefined();
  });

  it("is undefined for an unknown slug — reading never throws, only writing does", () => {
    expect(currentRegistryCommissionBps(fixture(), "ghost")).toBeUndefined();
  });
});

describe("setRegistryCommissionBps", () => {
  it("inserts a rate right after stripe_account: on a tenant that has one", () => {
    const { yaml, changed } = setRegistryCommissionBps(fixture(), "pays", 175);
    expect(changed).toBe(true);
    expect(extractBlock(yaml, "pays")).toBe(
      [
        "  pays:",
        "    name: Pays By Card",
        "    status: active",
        "    managed: scripts",
        "    box: staging",
        "    domain: pays.sofrapiwas.com",
        "    domain_mode: subdomain",
        "    db: tenant_pays",
        "    languages: [en]",
        "    modules: [core, online-payments]",
        "    stripe_account: acct_1PaysExample",
        "    payments_commission_bps: 175",
      ].join("\n"),
    );
  });

  it("refuses a tenant with no stripe_account — provision-tenant.sh would refuse this before the database", () => {
    // `unpaired` bought online-payments but has no account (the exact real-world
    // shape the fixture's own P3 comment documents).
    expect(() => setRegistryCommissionBps(fixture(), "unpaired", 150)).toThrow(
      MissingStripeAccountError,
    );
  });

  it("replaces an existing value in place, preserving its indentation", () => {
    const { yaml, changed } = setRegistryCommissionBps(fixture(), "commissioned", 300);
    expect(changed).toBe(true);
    const block = extractBlock(yaml, "commissioned");
    expect(block).toContain("    payments_commission_bps: 300");
    expect(block).not.toContain("payments_commission_bps: 200");
    // Exactly one line still — a replace must not duplicate the key.
    expect(block.match(/payments_commission_bps:/g)).toHaveLength(1);
  });

  it("deletes the line entirely at 0 — absent means 0, so the line would be redundant noise", () => {
    const { yaml, changed } = setRegistryCommissionBps(fixture(), "commissioned", 0);
    expect(changed).toBe(true);
    expect(extractBlock(yaml, "commissioned")).not.toContain("payments_commission_bps");
    // The rest of the block survives — this isn't a block-level rewrite.
    expect(extractBlock(yaml, "commissioned")).toContain("stripe_account: acct_1CommissionedExample");
  });

  it("is a no-op at 0 when the key was already absent — byte-identical output", () => {
    const original = fixture();
    const { yaml, changed } = setRegistryCommissionBps(original, "pays", 0);
    expect(changed).toBe(false);
    expect(yaml).toBe(original);
  });

  it("refuses an unknown slug", () => {
    expect(() => setRegistryCommissionBps(fixture(), "ghost", 100)).toThrow(
      UnknownRegistryTenantError,
    );
  });

  it("refuses an out-of-range or non-integer rate", () => {
    expect(() => setRegistryCommissionBps(fixture(), "pays", -1)).toThrow(InvalidCommissionBpsError);
    expect(() => setRegistryCommissionBps(fixture(), "pays", 1001)).toThrow(InvalidCommissionBpsError);
    expect(() => setRegistryCommissionBps(fixture(), "pays", 1.5)).toThrow(InvalidCommissionBpsError);
  });

  it("preserves every comment byte-identically", () => {
    const original = fixture();
    const { yaml } = setRegistryCommissionBps(original, "pays", 175);
    const p3Comment = [
      "  # P3 — the two Stripe shapes the founder must be able to tell apart on",
      "  # /admin/tenants. `pays` bought the module and has the account (the pair",
      "  # `provision-tenant.sh:94` demands); `unpaired` bought it and has none, which",
      "  # only a hand-edit can produce and which makes every re-provision a no-op.",
    ].join("\n");
    const s2aComment = [
      "  # S2a fixtures (SOFRA-PAYMENTS-PRICING-MODE-PLAN) — `commissioned` already carries",
      "  # a rate so a test can exercise REPLACE (bps > 0) and REMOVE (bps === 0) against a",
      "  # real existing line rather than a hand-built one. `demo2` exists ONLY to prove a",
      "  # slug that is a PREFIX of another (`demo`) cannot match it.",
    ].join("\n");
    // Present in the source fixture (sanity — a typo here would make the test vacuous)…
    expect(original).toContain(p3Comment);
    expect(original).toContain(s2aComment);
    // …and untouched by an edit to an entry elsewhere in the file.
    expect(yaml).toContain(p3Comment);
    expect(yaml).toContain(s2aComment);
  });

  it("touches ONLY the edited tenant's block — every other block is byte-identical", () => {
    const original = fixture();
    const { yaml } = setRegistryCommissionBps(original, "pays", 175);
    for (const slug of ALL_SLUGS.filter((s) => s !== "pays")) {
      expect(extractBlock(yaml, slug)).toBe(extractBlock(original, slug));
    }
  });

  it("a slug that is a PREFIX of another tenant's slug does not match it", () => {
    const original = fixture();
    // `demo2` (unlike `demo`) has a stripe_account, so this is a discriminating
    // check, not a coincidence: if `demo`'s request ever reached `demo2`'s block
    // by a prefix-matching bug, setting `demo` would wrongly SUCCEED (demo2 has
    // an account) instead of refusing.
    expect(() => setRegistryCommissionBps(original, "demo", 150)).toThrow(
      MissingStripeAccountError,
    );
    // …and the reverse: demo2 (which DOES have an account) must actually accept
    // the rate rather than being refused as if it were `demo`.
    const { yaml, changed } = setRegistryCommissionBps(original, "demo2", 150);
    expect(changed).toBe(true);
    expect(extractBlock(yaml, "demo2")).toContain("payments_commission_bps: 150");
    // And demo itself must be completely untouched by that edit.
    expect(extractBlock(yaml, "demo")).toBe(extractBlock(original, "demo"));
  });

  it("is idempotent — applying the same value twice is a no-op the second time, byte-identical", () => {
    const first = setRegistryCommissionBps(fixture(), "pays", 175);
    expect(first.changed).toBe(true);
    const second = setRegistryCommissionBps(first.yaml, "pays", 175);
    expect(second.changed).toBe(false);
    expect(second.yaml).toBe(first.yaml);
  });
});
