import { describe, expect, it } from "vitest";
import { emailLocale, emailTranslator } from "@/lib/email-locale";
import { routing } from "@/i18n/routing";

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
