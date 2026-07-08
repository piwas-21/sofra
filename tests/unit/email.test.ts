import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escapeHtml, founderInbox, siteUrl } from "@/lib/email";

// Pure helpers only — sendEmail() is network (Resend fetch) and is deliberately
// out of unit scope (no mocks, LIVE key). siteUrl/founderInbox read env, so we
// snapshot and restore process.env around each case (same pattern as
// tenant-registry.test.ts / mollie.test.ts).

describe("escapeHtml", () => {
  it("escapes &, <, and >", () => {
    expect(escapeHtml('<a href="x">1 & 2</a>')).toBe('&lt;a href="x"&gt;1 &amp; 2&lt;/a&gt;');
  });

  it("escapes & before < and > so entities are not double-escaped", () => {
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("leaves quotes and plain text untouched", () => {
    expect(escapeHtml('he said "hi"')).toBe('he said "hi"');
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("siteUrl (env fallback chain)", () => {
  // Per-key save/restore (matches tenant-registry/mollie tests) — never
  // reassign process.env wholesale (Node's env object has native getters).
  const savedAuth = process.env.NEXTAUTH_URL;
  const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    if (savedAuth === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = savedAuth;
    if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
  });

  it("prefers NEXTAUTH_URL", () => {
    process.env.NEXTAUTH_URL = "https://sofrapiwas.com";
    process.env.NEXT_PUBLIC_SITE_URL = "https://ignored.example";
    expect(siteUrl()).toBe("https://sofrapiwas.com");
  });

  it("falls back to NEXT_PUBLIC_SITE_URL when NEXTAUTH_URL is unset", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example";
    expect(siteUrl()).toBe("https://staging.example");
  });

  it("defaults to localhost when neither is set", () => {
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});

describe("founderInbox", () => {
  const savedTo = process.env.WAITLIST_TO;
  afterEach(() => {
    if (savedTo === undefined) delete process.env.WAITLIST_TO;
    else process.env.WAITLIST_TO = savedTo;
  });

  it("returns WAITLIST_TO when set", () => {
    process.env.WAITLIST_TO = "founder@example.com";
    expect(founderInbox()).toBe("founder@example.com");
  });

  it("returns undefined when WAITLIST_TO is unset", () => {
    delete process.env.WAITLIST_TO;
    expect(founderInbox()).toBeUndefined();
  });
});
