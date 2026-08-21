import { describe, expect, it } from "vitest";
import {
  billingIdentitySchema,
  canSkipVatCheck,
  carriedStatusFor,
  isInvoiceable,
  nextVatStatus,
  shouldReplaceVatEvidence,
  type IdentityFacts,
} from "@/lib/billing-identity";

const facts = (over: Partial<IdentityFacts> = {}): IdentityFacts => ({
  legalName: "Dupont Jean",
  addressLine1: "12 Rue de l'Exemple",
  postalCode: "01000",
  city: "Bourg-en-Bresse",
  countryCode: "FR",
  billingEmail: "billing@example.com",
  ...over,
});

describe("isInvoiceable", () => {
  it("accepts a complete identity", () => {
    expect(isInvoiceable(facts())).toBe(true);
  });

  it("does NOT require a VAT number", () => {
    // A Swiss tenant and a Dutch consumer are both invoiceable without one, and
    // requiring it would block exactly the customers whose treatment is settled.
    expect(isInvoiceable(facts({ countryCode: "CH" }))).toBe(true);
  });

  it("refuses a missing identity outright", () => {
    expect(isInvoiceable(null)).toBe(false);
    expect(isInvoiceable(undefined)).toBe(false);
  });

  it("refuses each required field individually", () => {
    for (const key of [
      "legalName",
      "addressLine1",
      "postalCode",
      "city",
      "billingEmail",
    ] as const) {
      expect(isInvoiceable(facts({ [key]: "" })), key).toBe(false);
    }
  });

  it("treats whitespace as absent — a space is not an address", () => {
    expect(isInvoiceable(facts({ addressLine1: "   " }))).toBe(false);
  });

  it("refuses a country code that is not a 2-letter uppercase ISO code", () => {
    // The field that decides the entire tax treatment. Anything unparseable here
    // must stop the invoice rather than be guessed at.
    for (const countryCode of ["", "F", "FRA", "fr", "12"]) {
      expect(isInvoiceable(facts({ countryCode })), countryCode).toBe(false);
    }
  });

  it("refuses two letters that name no country, however well-formed", () => {
    // The stored value that prompted this: `SW` for Switzerland. It passed the
    // shape test, so the row was invoiceable and the invoice printed a country
    // code that no register knows.
    for (const countryCode of ["SW", "UK", "XX", "EL"]) {
      expect(isInvoiceable(facts({ countryCode })), countryCode).toBe(false);
    }
  });
});

describe("nextVatStatus — an outage must never erase a proven VALID", () => {
  it("keeps VALID when VIES could not be reached", () => {
    // The rule this module exists for. A re-check during a member-state outage
    // would otherwise downgrade a customer validated last quarter and silently
    // retract the reverse charge on their next invoice.
    expect(nextVatStatus("VALID", "UNAVAILABLE")).toBe("VALID");
  });

  it("DOES accept VALID -> INVALID, which is a real verdict", () => {
    // A customer who deregistered must stop being reverse-charged. The
    // preservation rule is about outages, not about clinging to good news.
    expect(nextVatStatus("VALID", "INVALID")).toBe("INVALID");
  });

  it("takes the new answer in every other combination", () => {
    const all = ["NONE", "UNCHECKED", "VALID", "INVALID", "UNAVAILABLE"] as const;
    for (const current of all) {
      for (const incoming of all) {
        if (current === "VALID" && incoming === "UNAVAILABLE") continue;
        expect(nextVatStatus(current, incoming), `${current}->${incoming}`).toBe(incoming);
      }
    }
  });

  it("lets an unproven status be replaced by UNAVAILABLE", () => {
    // Only a VALID is worth protecting — it is the only one carrying evidence.
    expect(nextVatStatus("INVALID", "UNAVAILABLE")).toBe("UNAVAILABLE");
    expect(nextVatStatus("UNCHECKED", "UNAVAILABLE")).toBe("UNAVAILABLE");
  });
});

describe("carriedStatusFor — a status belongs to the number it was proven for", () => {
  const stored = { vatNumber: "FR27981106214", vatStatus: "VALID" as const };

  it("carries the stored status when the number is unchanged", () => {
    expect(carriedStatusFor(stored, "FR27981106214")).toBe("VALID");
  });

  it("REFUSES to carry VALID onto a different number", () => {
    // The hole this closes. Without it, the outage-preservation rule becomes the
    // attack: change the number, have VIES throttle (5 calls in 8 on the FR
    // node), and `VALID` survives — for a number nobody ever asked about, beside
    // the OLD number's consultation reference as its evidence. That is a
    // 0%-rated reverse-charge invoice and an ICP line for an unverified number.
    expect(carriedStatusFor(stored, "FR40303265045")).toBe("NONE");
  });

  it("carries nothing when there is no stored identity at all", () => {
    expect(carriedStatusFor(null, "FR27981106214")).toBe("NONE");
  });

  it("carries nothing when the stored row has no number", () => {
    expect(carriedStatusFor({ vatNumber: null, vatStatus: "VALID" }, "FR27981106214")).toBe("NONE");
  });
});

describe("canSkipVatCheck", () => {
  it("skips a settled answer on an unchanged number", () => {
    // A member state's verdict does not change between two saves, and re-asking
    // makes correcting a typo in `city` block up to 40s on a throttling API.
    expect(canSkipVatCheck({ vatNumber: "FR1", vatStatus: "VALID" }, "FR1")).toBe(true);
    expect(canSkipVatCheck({ vatNumber: "FR1", vatStatus: "INVALID" }, "FR1")).toBe(true);
  });

  it("never skips an unsettled one — that is the retry", () => {
    for (const vatStatus of ["NONE", "UNCHECKED", "UNAVAILABLE"] as const) {
      expect(canSkipVatCheck({ vatNumber: "FR1", vatStatus }, "FR1"), vatStatus).toBe(false);
    }
  });

  it("never skips a CHANGED number, however settled the old one was", () => {
    expect(canSkipVatCheck({ vatNumber: "FR1", vatStatus: "VALID" }, "FR2")).toBe(false);
  });

  it("never skips under force — an explicit re-check must reach VIES", () => {
    expect(canSkipVatCheck({ vatNumber: "FR1", vatStatus: "VALID" }, "FR1", true)).toBe(false);
  });

  it("does not skip when nothing is stored", () => {
    expect(canSkipVatCheck(null, "FR1")).toBe(false);
  });
});

describe("the two rules together — force must not defeat number-scoping", () => {
  it("a forced re-check of the SAME number still preserves a VALID through an outage", () => {
    // The trap in the fix: making `force` work by pretending the number differed
    // would drop the preservation rule and let an outage downgrade the very VALID
    // it exists to protect. Force skips the shortcut; scoping is unaffected.
    const stored = { vatNumber: "FR27981106214", vatStatus: "VALID" as const };
    expect(canSkipVatCheck(stored, "FR27981106214", true)).toBe(false);
    const carried = carriedStatusFor(stored, "FR27981106214");
    expect(nextVatStatus(carried, "UNAVAILABLE")).toBe("VALID");
    expect(shouldReplaceVatEvidence(carried, "UNAVAILABLE")).toBe(false);
  });

  it("a SUBSTITUTED number gets no such protection", () => {
    const stored = { vatNumber: "FR27981106214", vatStatus: "VALID" as const };
    const carried = carriedStatusFor(stored, "FR40303265045");
    expect(nextVatStatus(carried, "UNAVAILABLE")).toBe("UNAVAILABLE");
    // …and the evidence IS replaced, so no stale reference survives.
    expect(shouldReplaceVatEvidence(carried, "UNAVAILABLE")).toBe(true);
  });
});

describe("shouldReplaceVatEvidence", () => {
  it("keeps the old reference and date when a VALID survives an outage", () => {
    // Re-stamping them with the moment we FAILED to reach VIES would read as
    // "verified today" on an invoice and in an audit.
    expect(shouldReplaceVatEvidence("VALID", "UNAVAILABLE")).toBe(false);
  });

  it("refreshes the evidence on a successful re-check", () => {
    expect(shouldReplaceVatEvidence("VALID", "VALID")).toBe(true);
  });

  it("replaces evidence whenever the status itself is taken from the new answer", () => {
    expect(shouldReplaceVatEvidence("VALID", "INVALID")).toBe(true);
    expect(shouldReplaceVatEvidence("UNCHECKED", "UNAVAILABLE")).toBe(true);
    expect(shouldReplaceVatEvidence("NONE", "VALID")).toBe(true);
  });
});

describe("billingIdentitySchema", () => {
  const valid = {
    legalName: "Dupont Jean",
    addressLine1: "12 Rue de l'Exemple",
    postalCode: "01000",
    city: "Bourg-en-Bresse",
    countryCode: "FR",
    billingEmail: "billing@example.com",
  };

  it("accepts the minimum an invoice needs", () => {
    expect(billingIdentitySchema.safeParse(valid).success).toBe(true);
  });

  it("uppercases the country code, so 'fr' and 'FR' cannot diverge in storage", () => {
    const parsed = billingIdentitySchema.safeParse({ ...valid, countryCode: "fr" });
    expect(parsed.success && parsed.data.countryCode).toBe("FR");
  });

  it("rejects a country code that is not two letters", () => {
    for (const countryCode of ["FRA", "F", "", "F1"]) {
      expect(billingIdentitySchema.safeParse({ ...valid, countryCode }).success, countryCode).toBe(
        false,
      );
    }
  });

  it("rejects two letters that are not a country — the live SW defect", () => {
    // `SW` sat on the one reseller identity in production for nine days: it has
    // the right shape, it is assigned to nothing, and it decides the tax
    // treatment. The old `/^[A-Z]{2}$/` accepted it.
    for (const countryCode of ["SW", "UK", "XX", "QQ", "EL"]) {
      expect(billingIdentitySchema.safeParse({ ...valid, countryCode }).success, countryCode).toBe(
        false,
      );
    }
  });

  it("accepts the country that one was meant to be", () => {
    const parsed = billingIdentitySchema.safeParse({ ...valid, countryCode: "ch" });
    expect(parsed.success && parsed.data.countryCode).toBe("CH");
  });

  it("does NOT format-check the VAT number", () => {
    // A Swiss or British registration is real and simply not an EU VAT id;
    // refusing to record it would lose data. The EU-shape check happens where it
    // matters — before a VIES call and before a reverse charge.
    expect(billingIdentitySchema.safeParse({ ...valid, vatNumber: "CHE-116.281.277" }).success).toBe(
      true,
    );
  });

  it("accepts an omitted or empty VAT number", () => {
    expect(billingIdentitySchema.safeParse({ ...valid, vatNumber: "" }).success).toBe(true);
    expect(billingIdentitySchema.safeParse(valid).success).toBe(true);
  });

  it("requires a real email — the invoice has to reach someone", () => {
    expect(billingIdentitySchema.safeParse({ ...valid, billingEmail: "nope" }).success).toBe(false);
  });
});
