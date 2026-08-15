import { describe, expect, it } from "vitest";
import {
  applySchema,
  billingSchema,
  clientSchema,
  commissionSchema,
  noteSchema,
  onboardSchema,
  partnerStatusSchema,
  PARTNER_STATUSES,
  provisionSchema,
  splitCsvLower,
  signupSchema,
  signupStatusSchema,
  SIGNUP_STATUSES,
} from "@/lib/validation";

describe("applySchema (partner application)", () => {
  const valid = { name: "Ada", email: "ada@example.com", message: "Hi there" };

  it("accepts a minimal valid application and defaults locale to en", () => {
    const parsed = applySchema.parse(valid);
    expect(parsed.locale).toBe("en");
  });

  it("trims name and email", () => {
    const parsed = applySchema.parse({ ...valid, name: "  Ada  ", email: "  ada@example.com " });
    expect(parsed.name).toBe("Ada");
    expect(parsed.email).toBe("ada@example.com");
  });

  it("rejects an empty name", () => {
    expect(applySchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(applySchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(applySchema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });

  it("allows an empty-string company (optional-or-literal)", () => {
    expect(applySchema.safeParse({ ...valid, company: "" }).success).toBe(true);
  });
});

describe("signupSchema (direct restaurant signup)", () => {
  const valid = {
    restaurantName: "SofraPiwas Demo",
    contactName: "Ada Owner",
    email: "ada@example.com",
  };

  it("accepts a minimal valid signup and defaults locale to en", () => {
    const parsed = signupSchema.parse(valid);
    expect(parsed.locale).toBe("en");
  });

  it("trims and lower-cases nothing it shouldn't, but trims whitespace", () => {
    const parsed = signupSchema.parse({ ...valid, restaurantName: "  SofraPiwas Demo  " });
    expect(parsed.restaurantName).toBe("SofraPiwas Demo");
  });

  it("requires restaurantName, contactName, and email", () => {
    expect(signupSchema.safeParse({ ...valid, restaurantName: "" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, contactName: "" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });

  it("allows empty-string optionals (phone/city/desiredSlug/message)", () => {
    expect(
      signupSchema.safeParse({ ...valid, phone: "", city: "", desiredSlug: "", message: "" })
        .success,
    ).toBe(true);
  });

  it("accepts a canonical desiredSlug and reuses the registry grammar", () => {
    expect(signupSchema.safeParse({ ...valid, desiredSlug: "sofra-demo" }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valid, desiredSlug: "SofraPiwas" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, desiredSlug: "-x" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, desiredSlug: "a" }).success).toBe(false);
  });

  it("rejects an over-length message", () => {
    expect(signupSchema.safeParse({ ...valid, message: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("clientSchema", () => {
  it("requires a restaurant name", () => {
    expect(clientSchema.safeParse({ restaurantName: "" }).success).toBe(false);
  });

  it("accepts only a restaurant name (all else optional)", () => {
    expect(clientSchema.safeParse({ restaurantName: "SofraPiwas Demo" }).success).toBe(true);
  });

  it("rejects a bad email when one is supplied", () => {
    expect(
      clientSchema.safeParse({ restaurantName: "X", email: "nope" }).success,
    ).toBe(false);
  });
});

describe("partnerStatusSchema", () => {
  it("accepts every partner-settable status", () => {
    for (const s of PARTNER_STATUSES) {
      expect(partnerStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects admin-only / onboarding statuses", () => {
    for (const s of ["LIVE", "CHURNED", "ONBOARDING", "lead"]) {
      expect(partnerStatusSchema.safeParse(s).success).toBe(false);
    }
  });
});

describe("signupStatusSchema", () => {
  it("accepts every admin-settable signup status", () => {
    for (const s of SIGNUP_STATUSES) {
      expect(signupStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects NEW (initial only) and unknown values", () => {
    for (const s of ["NEW", "PENDING", "converted", ""]) {
      expect(signupStatusSchema.safeParse(s).success).toBe(false);
    }
  });
});

describe("noteSchema", () => {
  it("rejects blank / whitespace-only bodies", () => {
    expect(noteSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("rejects an over-length body", () => {
    expect(noteSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("commissionSchema (EUR amount coerced from string)", () => {
  const base = { partnerId: "p1", note: "Q3 referral" };

  it("coerces a decimal string to a number", () => {
    const parsed = commissionSchema.parse({ ...base, amount: "120.50" });
    expect(parsed.amount).toBeCloseTo(120.5);
  });

  it("requires a partnerId", () => {
    expect(commissionSchema.safeParse({ ...base, partnerId: "", amount: "1" }).success).toBe(false);
  });

  it("rejects amounts at/over the 100k bound", () => {
    expect(commissionSchema.safeParse({ ...base, amount: "100000" }).success).toBe(false);
  });

  it("allows negative commission (claw-back)", () => {
    expect(commissionSchema.safeParse({ ...base, amount: "-50" }).success).toBe(true);
  });

  it("requires a note", () => {
    expect(commissionSchema.safeParse({ ...base, amount: "1", note: "" }).success).toBe(false);
  });
});

describe("billingSchema (Mollie tenant billing) — slug grammar", () => {
  const base = {
    name: "Rumi Restaurant",
    email: "owner@example.com",
    description: "SofraPiwas Core — monthly",
    amount: "129.00",
    interval: "month" as const,
  };

  it("accepts a canonical slug + rounds nothing on amount coercion", () => {
    const parsed = billingSchema.parse({ ...base, tenantSlug: "rumi" });
    expect(parsed.tenantSlug).toBe("rumi");
    expect(parsed.amount).toBeCloseTo(129);
  });

  it("accepts hyphenated slugs", () => {
    expect(billingSchema.safeParse({ ...base, tenantSlug: "rumi-geneva" }).success).toBe(true);
  });

  it("rejects a single-char slug (min 2)", () => {
    expect(billingSchema.safeParse({ ...base, tenantSlug: "r" }).success).toBe(false);
  });

  it("rejects a leading hyphen", () => {
    expect(billingSchema.safeParse({ ...base, tenantSlug: "-rumi" }).success).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(billingSchema.safeParse({ ...base, tenantSlug: "Rumi" }).success).toBe(false);
  });

  it("rejects an over-length slug (>31 chars)", () => {
    expect(billingSchema.safeParse({ ...base, tenantSlug: "a".repeat(32) }).success).toBe(false);
  });

  it("rejects a zero / negative amount", () => {
    expect(billingSchema.safeParse({ ...base, tenantSlug: "rumi", amount: "0" }).success).toBe(false);
  });

  it("rejects an unknown interval", () => {
    expect(
      billingSchema.safeParse({ ...base, tenantSlug: "rumi", interval: "week" }).success,
    ).toBe(false);
  });
});

describe("onboardSchema (partner onboarding)", () => {
  const base = {
    name: "Ada Partner",
    email: "partner@example.com",
    tenantSlug: "rumi",
    restaurantName: "RUMI Restaurant",
    amount: "89.00",
    interval: "month" as const,
  };

  it("accepts a full onboarding with a go-live date and coerces the amount", () => {
    const parsed = onboardSchema.parse({ ...base, liveSince: "2026-06-29" });
    expect(parsed.tenantSlug).toBe("rumi");
    expect(parsed.restaurantName).toBe("RUMI Restaurant");
    expect(parsed.amount).toBeCloseTo(89);
    expect(parsed.liveSince).toBe("2026-06-29");
  });

  it("allows an omitted or empty liveSince", () => {
    expect(onboardSchema.safeParse(base).success).toBe(true);
    expect(onboardSchema.safeParse({ ...base, liveSince: "" }).success).toBe(true);
  });

  it("rejects a non-ISO liveSince", () => {
    expect(onboardSchema.safeParse({ ...base, liveSince: "29-06-2026" }).success).toBe(false);
  });

  it("rejects an impossible calendar date that passes the format regex", () => {
    expect(onboardSchema.safeParse({ ...base, liveSince: "2026-02-31" }).success).toBe(false);
    expect(onboardSchema.safeParse({ ...base, liveSince: "2026-13-01" }).success).toBe(false);
  });

  it("reuses the registry slug grammar (rejects uppercase / leading hyphen)", () => {
    expect(onboardSchema.safeParse({ ...base, tenantSlug: "Rumi" }).success).toBe(false);
    expect(onboardSchema.safeParse({ ...base, tenantSlug: "-rumi" }).success).toBe(false);
  });

  it("requires a restaurant name and a positive amount", () => {
    expect(onboardSchema.safeParse({ ...base, restaurantName: "" }).success).toBe(false);
    expect(onboardSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
  });

  it("rejects a malformed partner email", () => {
    expect(onboardSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });
});

describe("provisionSchema (ADR-012 tenant proposal)", () => {
  const base = {
    slug: "bistro-nova",
    name: "Bistro Nova",
    adminEmail: "owner@nova.example",
    template: "craft",
    currency: "EUR",
    languages: "en, nl",
    modules: "core, reservations",
    city: "Rotterdam",
  };

  it("accepts a well-formed proposal", () => {
    expect(provisionSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a module that is not in the ADR-010 catalog", () => {
    // The failure this prevents is silent: the registry would carry the typo,
    // the tenant env would carry it too, and the customer would simply never
    // get the module they are paying for.
    const bad = provisionSchema.safeParse({ ...base, modules: "core, kitchen" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain("kitchen-board");
  });

  it("rejects a language the tenant app cannot serve", () => {
    // Same silent failure as the module typo, with a longer fuse. Since GAP-2 S9 the
    // registry's languages list is what provision-tenant.sh writes into the tenant's
    // Localization__SupportedLanguages — the languages that tenant's MAIL is written in
    // — and the script refuses an unknown code ON THE BOX, inside the unattended merge
    // chain. Refusing it in the form is the difference between a red field and a failed
    // provisioning run nobody is watching.
    const bad = provisionSchema.safeParse({ ...base, languages: "en, kl" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain("unknown language");
  });

  it("tolerates the spacing and casing the action would normalise anyway", () => {
    expect(provisionSchema.safeParse({ ...base, modules: " Core ,  LOYALTY " }).success).toBe(true);
    expect(provisionSchema.safeParse({ ...base, languages: " EN ,  NL " }).success).toBe(true);
  });

  it("still rejects an empty module list", () => {
    expect(provisionSchema.safeParse({ ...base, modules: "" }).success).toBe(false);
  });

  it("accepts a Stripe account id, and treats absent/empty as 'not supplied'", () => {
    // Optional by design: the self-serve path never has one, and the founder path only
    // sometimes does. Empty must parse, because empty is the signal that makes the
    // generator hold `online-payments` back rather than propose a refused entry.
    expect(provisionSchema.safeParse({ ...base, stripeAccount: "acct_1AbCdEfGhIjKlMnO" }).success).toBe(true);
    expect(provisionSchema.safeParse({ ...base, stripeAccount: "" }).success).toBe(true);
    expect(provisionSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a malformed Stripe account id rather than forwarding it", () => {
    // This value reaches the tenant's Stripe env. A typo there is not a validation
    // nicety: charges would be addressed to an account that does not exist, and the
    // registry guard only checks that the field is NON-EMPTY, never that it is real.
    for (const bad of ["acct", "acct_", "1AbCdEfGhIjKlMnO", "acct_short", "acct_has spaces"]) {
      expect(provisionSchema.safeParse({ ...base, stripeAccount: bad }).success).toBe(false);
    }
  });

  it("rejects a line break inside the tenant name", () => {
    // `trim()` only strips the ENDS, so an interior newline used to survive — and the
    // name is forwarded into build-tenant-image.yml's `build-args:`, which is a
    // newline-delimited list. A second line there injects a build arg (e.g. a different
    // NEXT_PUBLIC_API_URL) into the tenant's own bundle.
    for (const name of ["Bistro\nNova", "Bistro\r\nNova", "Bistro\tNova", "Bistro\u0000Nova"]) {
      expect(provisionSchema.safeParse({ ...base, name }).success).toBe(false);
    }
    // Ordinary names, including non-ASCII and punctuation, are untouched.
    for (const name of ["Chez L'Ami", "Nova: Café — Bar", "北京饭店"]) {
      expect(provisionSchema.safeParse({ ...base, name }).success).toBe(true);
    }
  });
});

describe("splitCsvLower", () => {
  it("trims, lowercases and drops empties", () => {
    expect(splitCsvLower(" EN , nl ,, ")).toEqual(["en", "nl"]);
  });
});
