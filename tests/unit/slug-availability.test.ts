import { describe, expect, it } from "vitest";
import { checkSlug, isSlugUsable, RESERVED_SLUGS, suggestSlug } from "@/lib/slug-availability";

describe("checkSlug", () => {
  it("accepts a well-formed, unclaimed slug", () => {
    expect(checkSlug("chez-amara", ["rumi", "demo"])).toBe("available");
  });

  it("rejects slugs that break the registry grammar", () => {
    for (const bad of [
      "A", // too short AND uppercase
      "a", // single char — the pattern needs 2-31
      "-leading",
      "Chez-Amara",
      "chez amara",
      "chez_amara",
      "chez.amara",
      "a".repeat(32),
      "",
      null,
      undefined,
    ]) {
      expect(checkSlug(bad)).toBe("invalid");
    }
  });

  it("accepts the grammar's exact boundaries", () => {
    expect(checkSlug("ab")).toBe("available");
    expect(checkSlug(`a${"b".repeat(30)}`)).toBe("available"); // 31 chars
    expect(checkSlug(`a${"b".repeat(31)}`)).toBe("invalid"); // 32 — one over
  });

  it("reports a registry tenant as taken", () => {
    expect(checkSlug("rumi", ["rumi", "demo"])).toBe("taken");
    expect(checkSlug("demo", ["rumi", "demo"])).toBe("taken");
  });

  it("matches taken slugs despite case or whitespace in the registry", () => {
    // The grammar forbids both, but the registry is hand-edited YAML — a slug
    // must never slip through because someone left a trailing space.
    expect(checkSlug("rumi", [" RUMI "])).toBe("taken");
  });

  it("reports reserved words as reserved", () => {
    for (const s of ["www", "admin", "api", "app", "staging"]) {
      expect(checkSlug(s)).toBe("reserved");
    }
  });

  it("prefers taken over reserved when a name is somehow both", () => {
    // "another restaurant has it" is the more concrete, more actionable answer.
    expect(checkSlug("admin", ["admin"])).toBe("taken");
  });

  it("treats `demo` as a real tenant, never as a reserved word", () => {
    // demo.sofrapiwas.com is the live showcase. Reserving it would report the
    // showcase as unusable rather than as taken, and mislead the founder.
    expect(RESERVED_SLUGS).not.toContain("demo");
    expect(checkSlug("demo")).toBe("available");
    expect(checkSlug("demo", ["demo"])).toBe("taken");
  });

  it("defaults to no taken list, so it is usable on the client", () => {
    expect(checkSlug("chez-amara")).toBe("available");
  });

  it("keeps every reserved entry valid under the slug grammar", () => {
    // A reserved word that could never be typed anyway is dead weight, and hints
    // the list has drifted from the grammar it guards.
    for (const s of RESERVED_SLUGS) {
      expect(checkSlug(s, [])).toBe("reserved");
    }
  });

  it("has no duplicate reserved entries", () => {
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length);
  });
});

describe("isSlugUsable", () => {
  it("is true only for the available verdict", () => {
    expect(isSlugUsable("chez-amara")).toBe(true);
    expect(isSlugUsable("www")).toBe(false);
    expect(isSlugUsable("rumi", ["rumi"])).toBe(false);
    expect(isSlugUsable("Bad Slug")).toBe(false);
  });
});

describe("suggestSlug", () => {
  it("lower-cases and hyphenates a name", () =>
    expect(suggestSlug("O Bresse Bistro")).toBe("o-bresse-bistro"));

  it("FOLDS accents rather than dropping them", () => {
    // Dropped, a French or Turkish name gets a suggestion with holes in it — `Crème`
    // would become `crme`, which the partner then has to notice and fix.
    expect(suggestSlug("Crème Brûlée")).toBe("creme-brulee");
    expect(suggestSlug("Çiğköfteci")).toBe("cigkofteci");
  });

  it("collapses punctuation runs and trims the edges", () =>
    expect(suggestSlug("  --O'Bresse & Co.--  ")).toBe("o-bresse-co"));

  it("never ends on a dash after truncation", () => {
    const s = suggestSlug(`${"a".repeat(30)} bistro`);
    expect(s.length).toBeLessThanOrEqual(31);
    expect(s.endsWith("-")).toBe(false);
  });

  it("returns '' when nothing usable survives, rather than an invalid slug", () => {
    // The field is required, so an empty suggestion is simply an empty field — an
    // INVALID one would be pre-filled failure the partner has to diagnose.
    for (const name of ["", "!!!", "…", "é"]) {
      const s = suggestSlug(name);
      expect(s === "" || isSlugUsable(s)).toBe(true);
    }
  });

  it("only ever suggests something the grammar accepts", () => {
    for (const name of ["A", "ab", "Bistro 1", "L'Étoile du Nord", "北京饭店"]) {
      const s = suggestSlug(name);
      expect(s === "" || checkSlug(s) !== "invalid").toBe(true);
    }
  });

  it("does NOT consult the reserved or taken lists — that is the authorities' job", () => {
    // A suggestion that silently differed from the name would be harder to explain
    // than one the partner is asked to change.
    expect(suggestSlug("Mail")).toBe("mail");
    expect(checkSlug(suggestSlug("Mail"))).toBe("reserved");
  });
});
