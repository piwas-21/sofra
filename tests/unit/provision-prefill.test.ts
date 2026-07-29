import { describe, expect, it } from "vitest";
import {
  toProvisionPrefill,
  type SignupProvisionSource,
} from "@/lib/provision-prefill";

/** A fully-configured lead — the case the configurator produces today. */
const lead = (over: Partial<SignupProvisionSource> = {}): SignupProvisionSource => ({
  id: "sig_1",
  restaurantName: "Chez Amara",
  email: "Amara@Example.com",
  city: "Rotterdam",
  desiredSlug: "chez-amara",
  modules: "core,kitchen-board,cashier",
  languages: "en,nl",
  template: "craft",
  currency: "EUR",
  ...over,
});

describe("toProvisionPrefill", () => {
  it("maps a configured lead onto the registry-side fields", () => {
    expect(toProvisionPrefill(lead())).toEqual({
      signupId: "sig_1",
      slug: "chez-amara",
      name: "Chez Amara",
      adminEmail: "amara@example.com",
      city: "Rotterdam",
      template: "craft",
      currency: "EUR",
      modules: ["core", "kitchen-board", "cashier"],
      languages: ["en", "nl"],
    });
  });

  it("lower-cases the email so the field shows what the action will send", () => {
    // openProvisioningPrAction lower-cases adminEmail; a prefill that didn't
    // would appear to change on submit.
    expect(toProvisionPrefill(lead({ email: "OWNER@Bistro.NL" })).adminEmail).toBe(
      "owner@bistro.nl",
    );
  });

  it("leaves the choice fields undefined for a pre-configurator lead", () => {
    // Nullable columns: leads captured before O1 shipped have no product answers.
    // undefined (not a guess) is what lets the form keep its own defaults.
    const p = toProvisionPrefill(
      lead({ modules: null, languages: null, template: null, currency: null }),
    );
    expect(p.template).toBeUndefined();
    expect(p.currency).toBeUndefined();
    expect(p.modules).toEqual([]);
    expect(p.languages).toEqual([]);
  });

  it("defaults omitted free-text fields to empty strings, not undefined", () => {
    // They back text inputs; undefined would make them uncontrolled-vs-controlled.
    const p = toProvisionPrefill(lead({ desiredSlug: null, city: null }));
    expect(p.slug).toBe("");
    expect(p.city).toBe("");
  });

  it("drops values the current vocabulary no longer recognises", () => {
    // A row can be months old, hand-edited, or name an id since retired. Dropping
    // costs the founder one checkbox; carrying it costs a registry entry that
    // provision-tenant.sh rejects at the seam, far from where it came from.
    const p = toProvisionPrefill(
      lead({
        modules: "core,teleportation,cashier",
        languages: "en,nl,klingon",
        template: "brutalist",
        currency: "XYZ",
      }),
    );
    expect(p.modules).toEqual(["core", "cashier"]);
    expect(p.languages).toEqual(["en", "nl"]);
    expect(p.template).toBeUndefined();
    expect(p.currency).toBeUndefined();
  });

  it("tolerates the registry CSV grammar's spacing and duplicates", () => {
    const p = toProvisionPrefill(lead({ modules: " core , cashier , cashier ", languages: "en , en" }));
    expect(p.modules).toEqual(["core", "cashier"]);
    expect(p.languages).toEqual(["en"]);
  });

  it("reads the restaurant name, never the contact name, as the registry name", () => {
    // registry `name:` is the restaurant; the contact belongs to the billing side.
    expect(toProvisionPrefill(lead({ restaurantName: "Lin Noodles" })).name).toBe("Lin Noodles");
  });

  it("accepts the other valid template and currency", () => {
    const p = toProvisionPrefill(lead({ template: "classic", currency: "CHF" }));
    expect(p.template).toBe("classic");
    expect(p.currency).toBe("CHF");
  });
});
