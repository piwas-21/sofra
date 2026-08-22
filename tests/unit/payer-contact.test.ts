import { describe, expect, it } from "vitest";
import {
  payerAddress,
  payerGreetingName,
  payerLocale,
  type PayerContact,
} from "@/lib/payer-contact";

const base = (over: Partial<PayerContact> = {}): PayerContact => ({
  email: "restaurant@example.com",
  name: "Chez Amara",
  ...over,
});

describe("payerAddress", () => {
  it("prefers the address invoices already go to", () => {
    // A receipt, an invoice and a warning about the same bill must not arrive at
    // three different addresses.
    const to = payerAddress(
      base({
        billingIdentity: { billingEmail: "accounts@partner.example" },
        client: { partner: { name: "Mustafa", email: "mustafa@partner.example" } },
      }),
    );
    expect(to).toBe("accounts@partner.example");
  });

  it("writes to the PARTNER on a reseller plan, never to the restaurant", () => {
    // The whole point: on a reseller plan the restaurant is not the customer, and
    // mailing it our wholesale price leaks it into the partner's own relationship.
    expect(
      payerAddress(base({ client: { partner: { name: "Mustafa", email: "m@partner.example" } } })),
    ).toBe("m@partner.example");
  });

  it("writes to the direct owner when there is no reseller", () => {
    expect(payerAddress(base({ payer: { name: "Amara", email: "amara@example.com" } }))).toBe(
      "amara@example.com",
    );
  });

  it("falls back to the plan's own address only when nothing else exists", () => {
    expect(payerAddress(base({ client: null, payer: null }))).toBe("restaurant@example.com");
  });
});

describe("payerGreetingName", () => {
  it("greets the person, not the restaurant", () => {
    expect(
      payerGreetingName(base({ client: { partner: { name: "Mustafa", email: "m@p.example" } } })),
    ).toBe("Mustafa");
    expect(payerGreetingName(base({ payer: { name: "Amara", email: "a@e.com" } }))).toBe("Amara");
  });

  it("uses the restaurant when the plan carries no person at all", () => {
    // Clumsy ("Hi Chez Amara,") and still better than "Hi ,". Only reachable for a
    // plan with neither a partner nor a payer — a shape defineTenantPlan refuses.
    expect(payerGreetingName(base())).toBe("Chez Amara");
    expect(payerGreetingName(base({ payer: { name: null, email: "a@e.com" } }))).toBe("Chez Amara");
  });
});

describe("payerLocale — the language a bill is written in (G9)", () => {
  it("follows the PARTNER on a reseller plan, in the same order as the address", () => {
    // The partner is who pays and who reads it. The restaurant's own language is
    // not consulted at all, for the same reason its address is not.
    expect(
      payerLocale(
        base({
          client: { partner: { name: "Mustafa", email: "m@partner.example", locale: "fr" } },
          payer: { name: "Amara", email: "amara@example.com", locale: "nl" },
        }),
      ),
    ).toBe("fr");
  });

  it("follows the direct owner when there is no reseller", () => {
    expect(
      payerLocale(base({ payer: { name: "Amara", email: "amara@example.com", locale: "tr" } })),
    ).toBe("tr");
  });

  it("returns null when the plan carries no user at all", () => {
    // An admin-typed address and nothing else. `emailLocale` turns this into
    // English — a BillingIdentity records a country, and a country is not a
    // language: a Belgian company may read French, Dutch or English.
    expect(payerLocale(base({ client: null, payer: null }))).toBeNull();
    expect(payerLocale(base({ billingIdentity: { billingEmail: "a@b.example" } }))).toBeNull();
  });

  it("is null rather than empty when the selection omitted the column", () => {
    // A caller that selects only `email` must not silently resolve to "" and then
    // fail `hasLocale`, which would read as a deliberate choice of English.
    expect(payerLocale(base({ payer: { name: "Amara", email: "amara@example.com" } }))).toBeNull();
  });
});
