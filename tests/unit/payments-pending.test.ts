import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPaymentsPending } from "@/lib/payments-pending";

// O7 P4 (SOFRA-PAYMENTS-PLAN §9): the window between buying online payments and being
// granted them, and the copy rule that window's card must obey.

describe("isPaymentsPending", () => {
  const pending = (
    purchased: string | null,
    granted: string[] | undefined,
    registryReadable = true,
  ) => isPaymentsPending({ purchased, granted, registryReadable });

  it("is true for a buyer whose registry entry does not carry the module yet", () => {
    // The whole point of the card: P1 provisions this tenant WITHOUT the module, so
    // they are live, trading on cash, and paying for something they cannot see.
    expect(pending("core,reservations,online-payments", ["core", "reservations"])).toBe(true);
  });

  it("is false once the second registry PR grants it", () => {
    expect(pending("core,online-payments", ["core", "online-payments"])).toBe(false);
  });

  it("is false for a plan that never bought it, granted or not", () => {
    expect(pending("core,cashier", ["core", "cashier"])).toBe(false);
    // Not even when the founder granted a module nobody bought — that is a different
    // problem, and it is not this customer's to read about.
    expect(pending("core,cashier", ["core", "cashier", "online-payments"])).toBe(false);
  });

  it("is false for a founder-created plan, which has no lead and no record of a purchase", () => {
    expect(pending(null, ["core"])).toBe(false);
    expect(pending("", ["core"])).toBe(false);
  });

  it("tolerates the spacing a hand-edited CSV can carry", () => {
    expect(pending(" core , online-payments ", ["core"])).toBe(true);
  });

  it("is SILENT when the registry could not be read at all", () => {
    // The trap this exists for: an unreadable registry produces the same empty list as
    // "no entry yet", so a predicate that only took a list would tell a tenant who has
    // been taking cards for a month that their card payments are still being switched
    // on. Our ops failure, their dashboard — the quiet answer is the only honest one.
    expect(pending("core,online-payments", undefined, false)).toBe(false);
    // …and the SAME inputs with a readable registry do show the card, so the silence
    // above is the unreadability and not the missing entry.
    expect(pending("core,online-payments", undefined, true)).toBe(true);
  });
});

describe("the P4 card's copy rule (§9 Q1)", () => {
  // "A copy rule is only a rule if something fails when it is broken." The permitted
  // vocabulary is THEIR Stripe account, THEIR verification, and "we'll tell you when
  // it's on". A customer can act on none of the words below and should not have to
  // learn that they exist.
  //
  // Note `env` is matched as a SUBSTRING, deliberately: it catches "environment" and
  // it also catches, say, a French "nous vous enverrons" — which is exactly the kind
  // of accident that makes a substring rule feel wrong until you remember the rule is
  // cheap to satisfy and the alternative is a customer reading about our deploys.
  const FORBIDDEN = /env|environment|operator|box|deploy|registry|pull request|founder/i;
  const LOCALES = ["en", "fr", "de", "nl", "tr", "ar"] as const;

  const strings = (locale: string): Record<string, string> => {
    const path = fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url));
    return JSON.parse(readFileSync(path, "utf8")).control.paymentsPending;
  };

  it.each(LOCALES)("%s names nothing the customer cannot act on", (locale) => {
    const card = strings(locale);
    // Guard against a vacuous pass: an empty or missing namespace would satisfy every
    // assertion below without a single string being checked.
    expect(Object.keys(card).sort()).toEqual(
      ["billingNote", "body", "kicker", "stripeLink", "title"],
    );
    for (const [key, value] of Object.entries(card)) {
      expect(value.length, `${locale}.${key} is empty`).toBeGreaterThan(0);
      expect(FORBIDDEN.test(value), `${locale}.${key}: "${value}"`).toBe(false);
    }
  });
});
