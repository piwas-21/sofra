import { describe, expect, it } from "vitest";
import { formEmail } from "@/lib/auth-form";

// The shape check both anti-enumeration forms run before they touch the database.
// Its job is narrow — reject what is obviously not an address, cheaply — and the
// "cheaply" is load-bearing: the first version's `[^\s@]+\.[^\s@]+` tail let the
// engine split a domain in exponentially many ways, so a hostile string turned a
// validity check into a CPU bill (Sonar S5852, on a form open to the internet).

const fd = (email: unknown) => {
  const f = new FormData();
  if (typeof email === "string") f.set("email", email);
  return f;
};

describe("formEmail", () => {
  it("normalises case and surrounding space", () => {
    expect(formEmail(fd("  Owner@Example.COM "))).toBe("owner@example.com");
  });

  it("accepts a multi-label domain", () => {
    expect(formEmail(fd("chef@bistro.co.uk"))).toBe("chef@bistro.co.uk");
  });

  it("rejects what is not an address at all", () => {
    for (const bad of ["", "   ", "owner", "owner@", "@example.com", "owner@example", "a b@c.de"]) {
      expect(formEmail(fd(bad)), bad).toBeNull();
    }
  });

  it("rejects a missing field rather than stringifying whatever arrived", () => {
    // `formData.get()` returns File | string | null; `String(...)` on the first
    // renders "[object Object]", which is not an address but is not obviously not
    // one either.
    expect(formEmail(fd(undefined))).toBeNull();
  });

  it("answers a long hostile string immediately instead of backtracking on it", () => {
    const hostile = `owner@${"a".repeat(60)}${"!".repeat(20)}`;
    const started = Date.now();
    expect(formEmail(fd(hostile))).toBeNull();
    // Generous by three orders of magnitude: the point is that it RETURNS, not
    // that it is fast. The ambiguous version took exponential time on this shape.
    expect(Date.now() - started).toBeLessThan(200);
  });
});
