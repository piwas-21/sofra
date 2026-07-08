import { describe, expect, it } from "vitest";
import { craftEmail, detailRows } from "@/lib/email-templates";

// Pure HTML-string builders — no DB, no network, no mocks (sofra CLAUDE.md §7).
// The load-bearing contract: detailRows ESCAPES its key/value inputs (it renders
// untrusted founder-inbox values), while craftEmail trusts its bodyHtml (the
// caller pre-escapes dynamic values — see lib/email-templates.ts header).

describe("craftEmail", () => {
  it("renders the title inside the card heading", () => {
    const html = craftEmail({ title: "Welcome aboard", bodyHtml: "<p>hi</p>" });
    expect(html).toContain("<h1");
    expect(html).toContain("Welcome aboard");
  });

  it("passes trusted bodyHtml through verbatim (does not escape it)", () => {
    const html = craftEmail({ title: "T", bodyHtml: "<p>Line one</p><strong>bold</strong>" });
    expect(html).toContain("<p>Line one</p><strong>bold</strong>");
  });

  it("always includes the Sofra brand shell and a valid document", () => {
    const html = craftEmail({ title: "T", bodyHtml: "b" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(">Sofra<");
  });

  it("renders the kicker only when provided", () => {
    const withKicker = craftEmail({ kicker: "Partner program", title: "T", bodyHtml: "b" });
    expect(withKicker).toContain("Partner program");
    // The kicker sits in an uppercase-styled <p>; absent when omitted.
    const withoutKicker = craftEmail({ title: "T", bodyHtml: "b" });
    expect(withoutKicker).not.toContain("text-transform:uppercase");
  });

  it("renders the CTA button (href + label) only when provided", () => {
    const withCta = craftEmail({
      title: "T",
      bodyHtml: "b",
      cta: { label: "Open dashboard", url: "https://sofrapiwas.com/dashboard" },
    });
    expect(withCta).toContain('href="https://sofrapiwas.com/dashboard"');
    expect(withCta).toContain("Open dashboard");
    // The CTA button has a unique padding; the always-present footer link does not.
    expect(withCta).toContain("padding:12px 26px");

    const withoutCta = craftEmail({ title: "T", bodyHtml: "b" });
    expect(withoutCta).not.toContain("padding:12px 26px");
    expect(withoutCta).not.toContain("sofrapiwas.com/dashboard");
  });

  it("renders the footer note only when provided", () => {
    const withNote = craftEmail({ title: "T", bodyHtml: "b", footerNote: "Link expires in 24h" });
    expect(withNote).toContain("Link expires in 24h");
    const withoutNote = craftEmail({ title: "T", bodyHtml: "b" });
    expect(withoutNote).not.toContain("Link expires in 24h");
  });
});

describe("detailRows", () => {
  it("renders a row per key/value pair", () => {
    const html = detailRows([
      ["Name", "Ada"],
      ["City", "Geneva"],
    ]);
    expect(html).toContain("Name");
    expect(html).toContain("Ada");
    expect(html).toContain("City");
    expect(html).toContain("Geneva");
    expect(html.match(/<tr>/g)).toHaveLength(2);
  });

  it("escapes HTML-significant characters in values (injection guard)", () => {
    const html = detailRows([["Message", '<script>alert(1)</script> & "quote"']]);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp;");
    expect(html).not.toContain("<script>");
  });

  it("escapes keys as well as values", () => {
    const html = detailRows([["<b>k</b>", "v"]]);
    expect(html).toContain("&lt;b&gt;k&lt;/b&gt;");
    expect(html).not.toContain("<b>k</b>");
  });

  it("renders an empty table (no rows) for no pairs", () => {
    const html = detailRows([]);
    expect(html).toContain("<table");
    expect(html).not.toContain("<tr>");
  });
});
