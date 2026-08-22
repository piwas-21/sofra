import { describe, expect, it } from "vitest";
import { emailLocale, emailTranslator } from "@/lib/email-locale";
import { routing } from "@/i18n/routing";

/** Every leaf key under a message block, dotted — the same walk the parity gate does. */
function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? leafKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("emailLocale", () => {
  it("takes the first candidate we actually ship", () => {
    expect(emailLocale("fr")).toBe("fr");
    expect(emailLocale(null, undefined, "tr")).toBe("tr");
  });

  it("falls through anything we do not ship rather than rendering raw keys", () => {
    // A row can hold "de-CH", an empty string, or a locale we dropped. None of those
    // may reach `createTranslator` — a missing catalogue is a mail of message keys.
    expect(emailLocale("de-CH", "de")).toBe("de");
    expect(emailLocale("", null, undefined)).toBe(routing.defaultLocale);
    expect(emailLocale()).toBe("en");
  });
});

describe("emailTranslator", () => {
  it("renders the trial warning in every locale we ship", async () => {
    // The parity gate proves the KEYS exist in all six files; this proves they
    // RESOLVE and interpolate — an ICU syntax error in one translation is a mail
    // that throws at send time, in the one language nobody on the team reads.
    for (const locale of routing.locales) {
      const t = await emailTranslator(locale, "emails.trialEnding");
      const lead = t("lead.soon", { restaurant: "Chez Amara", date: "19 September 2026", days: 7 });
      expect(lead).toContain("Chez Amara");
      expect(lead).toContain("19 September 2026");
      expect(lead).toContain("7");
      expect(t("subject.today", { date: "x" })).not.toContain("{");
      expect(t("cta")).not.toHaveLength(0);
    }
  });

  it("pluralises the last day rather than saying '1 days'", async () => {
    const t = await emailTranslator("en", "emails.trialEnding");
    expect(t("lead.soon", { restaurant: "R", date: "d", days: 1 })).toContain("1 day from");
    expect(t("lead.soon", { restaurant: "R", date: "d", days: 3 })).toContain("3 days from");
  });

  it("falls back to English for a locale we do not have a catalogue for", async () => {
    const t = await emailTranslator("de-CH", "emails.trialEnding");
    expect(t("rowFreeUntil")).toBe("Free until");
  });

  it("reads the SAME catalogue the UI does, so a mail and a page use one vocabulary", async () => {
    // `control.plan.interval.*` is rendered on the partner's billing page and in the
    // price line of this mail. Two spellings of "month" would be two products.
    const t = await emailTranslator("nl", "control.plan");
    expect(t("interval.month")).toBe("maand");
  });
});

describe("emailTranslator — every customer-facing mail, in every locale we ship (G9)", () => {
  // The parity gate proves the KEYS exist in all six files. This proves they
  // RESOLVE and INTERPOLATE: an ICU syntax error — a stray brace, or an apostrophe
  // ICU reads as quoting, which French and Turkish copy is full of — is a mail that
  // THROWS at send time, in the one language nobody on the team reads. The invite is
  // the worst place for that: it is the only route into an account with no password.
  const NAMESPACES = [
    "emails.invite",
    "emails.partnerApproved",
    "emails.reset",
    "emails.invoice",
    "emails.billingDetails",
  ] as const;

  const VALUES = {
    name: "Amara",
    restaurant: "Chez Amara",
    number: "SP-2026-0007",
    amount: "€85.00",
  };

  it("renders every key of every namespace with no key left raw", async () => {
    for (const locale of routing.locales) {
      for (const namespace of NAMESPACES) {
        const messages = (await import(`../../messages/${locale}.json`)).default;
        const block = namespace
          .split(".")
          .reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, messages);
        const t = await emailTranslator(locale, namespace);
        for (const key of leafKeys(block)) {
          const rendered = t(key, VALUES);
          expect(rendered, `${locale} ${namespace}.${key}`).not.toContain("{");
          expect(rendered.trim(), `${locale} ${namespace}.${key}`).not.toHaveLength(0);
        }
      }
    }
  });

  it("keeps the values in the sentence, in every language", async () => {
    for (const locale of routing.locales) {
      const invite = await emailTranslator(locale, "emails.invite");
      expect(invite("lead.setPassword", VALUES), locale).toContain("Chez Amara");
      expect(invite("greeting", VALUES), locale).toContain("Amara");
      const invoice = await emailTranslator(locale, "emails.invoice");
      expect(invoice("subject", VALUES), locale).toContain("SP-2026-0007");
      const billing = await emailTranslator(locale, "emails.billingDetails");
      expect(billing("received", VALUES), locale).toContain("€85.00");
    }
  });

  it("keeps the brand in Latin script and the sign-off intact", async () => {
    // "SofraPiwas" is a name, including inside the Arabic sentence, and
    // "afiyet olsun" is the brand's sign-off rather than a phrase to translate.
    for (const locale of routing.locales) {
      const invite = await emailTranslator(locale, "emails.invite");
      expect(invite("kicker"), locale).toContain("SofraPiwas");
      expect(invite("lead.setPassword", VALUES), locale).toContain("afiyet olsun");
    }
  });

  it("keeps every subject short enough to survive an inbox list", async () => {
    // A subject that is truncated at the interesting word is a subject nobody
    // reads. 70 characters is the narrowest common mobile client.
    for (const locale of routing.locales) {
      const t = await emailTranslator(locale, "emails.billingDetails");
      expect(t("subject").length, `${locale} billingDetails.subject`).toBeLessThanOrEqual(70);
      const invite = await emailTranslator(locale, "emails.invite");
      expect(invite("subject.setPassword").length, `${locale} invite.subject`).toBeLessThanOrEqual(70);
    }
  });

  it("distinguishes the partner's reset sentence from everyone else's (G10)", async () => {
    for (const locale of routing.locales) {
      const t = await emailTranslator(locale, "emails.reset");
      expect(t("lead.partner"), locale).not.toBe(t("lead.account"));
      expect(t("kicker.partner"), locale).not.toBe(t("kicker.account"));
    }
  });
});
