import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, founderInbox, sendEmail, siteUrl, supportReplyTo } from "@/lib/email";

// Pure helpers only — sendEmail() is network (Resend fetch) and is deliberately
// out of unit scope (no mocks, LIVE key). siteUrl/founderInbox read env, so we
// snapshot and restore process.env around each case (same pattern as
// tenant-registry.test.ts / mollie.test.ts).
//
// The ONE exception is sendEmail's config guards below: they return before the
// fetch, so they are reachable without a network and without mocking a live key.
// They are worth pinning precisely because the bug they prevent is invisible —
// a sandbox-sender fallback delivers happily to the account owner (the only
// person who would test it) and 403s every real customer.

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

describe("sendEmail config guards (no network — both return before fetch)", () => {
  const savedKey = process.env.RESEND_API_KEY;
  const savedFrom = process.env.WAITLIST_FROM;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fail loudly if a guard ever stops short-circuiting: these tests must never
    // reach the network, so the spy throws rather than returning a stub response.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("sendEmail reached the network in a unit test");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
    if (savedFrom === undefined) delete process.env.WAITLIST_FROM;
    else process.env.WAITLIST_FROM = savedFrom;
  });

  const msg = { to: "guest@example.com", subject: "s", html: "<p>h</p>" };

  it("refuses to send when WAITLIST_FROM is unset, rather than using a sandbox sender", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.WAITLIST_FROM;
    await expect(sendEmail(msg)).resolves.toEqual({ sent: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("REFUSES rather than throws — billing-notify runs it inside the Mollie webhook", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.WAITLIST_FROM;
    // A throw here would fail a payment that has already settled.
    await expect(sendEmail(msg)).resolves.not.toThrow();
  });

  it("refuses when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.WAITLIST_FROM = "Sofra <sofra@send.sofrapiwas.com>";
    await expect(sendEmail(msg)).resolves.toEqual({ sent: false });
    expect(fetchSpy).not.toHaveBeenCalled();
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

describe("supportReplyTo (the reply path)", () => {
  const saved = process.env.SUPPORT_REPLY_TO;
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPPORT_REPLY_TO;
    else process.env.SUPPORT_REPLY_TO = saved;
  });

  it("returns the configured mailbox", () => {
    process.env.SUPPORT_REPLY_TO = "sofra@piwas.nl";
    expect(supportReplyTo()).toBe("sofra@piwas.nl");
  });

  it("is undefined when unset — no header, i.e. today's behaviour", () => {
    delete process.env.SUPPORT_REPLY_TO;
    expect(supportReplyTo()).toBeUndefined();
  });

  it("treats an EMPTY value as unset", () => {
    // Compose renders an unset variable as "", so `??` would have produced
    // `reply_to: ""` — a malformed header on every company mail. This is the
    // reason the implementation uses `||` and not `??`.
    process.env.SUPPORT_REPLY_TO = "";
    expect(supportReplyTo()).toBeUndefined();
  });
});
