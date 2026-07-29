import { describe, expect, it } from "vitest";
import { sanitizeSignupConfiguration } from "@/lib/signup-configuration";
import { quoteModules } from "@/lib/module-catalog";
import { isTemplateId, isTenantCurrency, parseCsv, TEMPLATES } from "@/lib/tenant-options";

describe("parseCsv", () => {
  it("drops blanks and duplicates, keeps order", () => {
    expect(parseCsv("a, b ,,a, c")).toEqual(["a", "b", "c"]);
  });

  it("treats null/undefined/empty as no selection", () => {
    expect(parseCsv(null)).toEqual([]);
    expect(parseCsv(undefined)).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
  });
});

describe("tenant option guards", () => {
  it("accepts only the templates provision-tenant.sh allows", () => {
    expect(isTemplateId("classic")).toBe(true);
    expect(isTemplateId("craft")).toBe(true);
    expect(isTemplateId("Craft")).toBe(false);
    expect(isTemplateId("bootstrap")).toBe(false);
  });

  it("accepts only supported currencies", () => {
    expect(isTenantCurrency("EUR")).toBe(true);
    expect(isTenantCurrency("CHF")).toBe(true);
    expect(isTenantCurrency("eur")).toBe(false);
    expect(isTenantCurrency("USD")).toBe(false);
  });
});

describe("sanitizeSignupConfiguration", () => {
  it("returns nothing-chosen when the lead selected nothing", () => {
    expect(sanitizeSignupConfiguration({})).toEqual({
      modules: null,
      languages: null,
      template: null,
      currency: null,
      quotedCents: null,
    });
  });

  it("always records core, even when the client omits it", () => {
    const c = sanitizeSignupConfiguration({ modules: "loyalty" });
    expect(parseCsv(c.modules)).toContain("core");
  });

  it("always records English first, whatever the client sent", () => {
    const c = sanitizeSignupConfiguration({ languages: "fr,de" });
    expect(c.languages).toBe("en,fr,de");
  });

  it("does not duplicate English when the client already sent it", () => {
    const c = sanitizeSignupConfiguration({ languages: "en,fr" });
    expect(c.languages).toBe("en,fr");
  });

  // The whole point of rule 1: a stale bundle must not cost a real lead.
  it("drops unknown ids instead of rejecting the signup", () => {
    const c = sanitizeSignupConfiguration({
      modules: "loyalty,telepathy",
      languages: "fr,klingon",
    });
    expect(parseCsv(c.modules)).toEqual(["core", "loyalty"]);
    expect(c.languages).toBe("en,fr");
  });

  it("falls back to the first template/currency rather than storing junk", () => {
    const c = sanitizeSignupConfiguration({ modules: "core", template: "wat", currency: "XXX" });
    expect(c.template).toBe(TEMPLATES[0].id);
    expect(c.currency).toBe("EUR");
  });

  // Without this, an implementation that ALWAYS returned the default would pass
  // the fallback test above — the CH market is the one that needs CHF.
  it("keeps a valid non-default currency and template", () => {
    const c = sanitizeSignupConfiguration({ modules: "core", template: "craft", currency: "CHF" });
    expect(c.currency).toBe("CHF");
    expect(c.template).toBe("craft");
    expect(TEMPLATES[0].id).not.toBe("craft");
  });

  // A tenant billed for extra-languages must also be MARKED as having it, or
  // the instance is provisioned without a module they are paying for.
  it("adds extra-languages to the recorded modules once a 3rd language is picked", () => {
    const c = sanitizeSignupConfiguration({ modules: "core", languages: "fr,de" });
    expect(parseCsv(c.modules)).toContain("extra-languages");
  });

  it("does not record extra-languages below the threshold", () => {
    const c = sanitizeSignupConfiguration({ modules: "core", languages: "fr" });
    expect(parseCsv(c.modules)).not.toContain("extra-languages");
  });

  it("strips a client-claimed extra-languages that the selection does not earn", () => {
    const c = sanitizeSignupConfiguration({ modules: "core,extra-languages", languages: "fr" });
    expect(parseCsv(c.modules)).not.toContain("extra-languages");
  });

  // Rule 2: the posted price is never stored.
  it("re-quotes from the catalog and ignores any posted price", () => {
    const c = sanitizeSignupConfiguration({ modules: "core,loyalty" });
    expect(c.quotedCents).toBe(quoteModules(["core", "loyalty"]).monthlyCents);
  });

  it("quotes the bundle price when the selection earns one", () => {
    // Exactly the «counter» bundle: core + kitchen-board + cashier + PRINTING
    // (not server — that one is full-service only).
    const counter = ["core", "kitchen-board", "cashier", "printing"];
    const c = sanitizeSignupConfiguration({ modules: counter.join(",") });
    const expected = quoteModules(counter);
    expect(c.quotedCents).toBe(expected.monthlyCents);
    // Sanity: the bundle really is cheaper than the parts, so this asserts the
    // bundle path rather than tautologically re-summing à la carte.
    expect(expected.bundle).toBe("counter");
    expect(expected.monthlyCents).toBeLessThan(expected.aLaCarteCents);
  });

  it("prices the extra-languages add-on it records", () => {
    const one = sanitizeSignupConfiguration({ modules: "core", languages: "fr" });
    const three = sanitizeSignupConfiguration({ modules: "core", languages: "fr,de" });
    expect(three.quotedCents).toBeGreaterThan(one.quotedCents!);
  });

  it("treats a template-only submission as a real configuration", () => {
    const c = sanitizeSignupConfiguration({ template: "craft" });
    expect(c.template).toBe("craft");
    expect(parseCsv(c.modules)).toEqual(["core"]);
  });
});
