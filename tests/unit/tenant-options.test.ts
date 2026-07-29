import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATES, isTemplateId } from "@/lib/tenant-options";

// The repo root, from tests/unit/ — `preview` paths are public/ URLs.
const publicFile = (url: string) =>
  fileURLToPath(new URL(`../../public${url}`, import.meta.url));

describe("TEMPLATES previews", () => {
  it("ships a preview asset that actually exists for every template", () => {
    // A renamed or dropped asset would otherwise show up as a broken image in
    // the public signup configurator and nowhere else — no error, no test, just
    // a customer choosing a theme they cannot see.
    for (const tpl of TEMPLATES) {
      const file = publicFile(tpl.preview);
      expect(existsSync(file), `${tpl.id}: missing ${tpl.preview}`).toBe(true);
    }
  });

  it("keeps each preview small enough to sit in a form without a spinner", () => {
    // These are crops of the S15 screenshot baselines, which are ~0.5-1.1 MB
    // PNGs. Committing one unconverted would quietly put a megabyte on the
    // signup page's critical path.
    for (const tpl of TEMPLATES) {
      const { size } = statSync(publicFile(tpl.preview));
      expect(size, `${tpl.id}: ${(size / 1024).toFixed(0)} KB`).toBeLessThan(80 * 1024);
    }
  });

  it("points every preview at a distinct file", () => {
    const paths = TEMPLATES.map((t) => t.preview);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("recognises exactly the template ids it lists", () => {
    for (const tpl of TEMPLATES) expect(isTemplateId(tpl.id)).toBe(true);
    expect(isTemplateId("brutalist")).toBe(false);
  });
});
