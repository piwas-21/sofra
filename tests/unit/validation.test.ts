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

describe("clientSchema", () => {
  it("requires a restaurant name", () => {
    expect(clientSchema.safeParse({ restaurantName: "" }).success).toBe(false);
  });

  it("accepts only a restaurant name (all else optional)", () => {
    expect(clientSchema.safeParse({ restaurantName: "Sofra Demo" }).success).toBe(true);
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
    description: "Sofra Core — monthly",
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
