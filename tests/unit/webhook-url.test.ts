import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webhookUrl } from "@/lib/billing";

// `webhookUrl()` is the one place a misconfiguration can silently break billing:
// point it away from the app and Mollie's retries never arrive, so a paid first
// payment sits `paid` with its subscription stuck PENDING and NOTHING reports it.
// That is why the override refuses a non-test key instead of merely warning — and
// why the refusal is pinned here rather than left to a comment.
//
// This imports lib/billing but touches neither the DB nor the network: only the
// env-reading branch is exercised (verified — the module imports with no
// DATABASE_URL set), so it stays inside §7's no-DB/no-network rule for unit tests.

const ENV_KEYS = ["MOLLIE_WEBHOOK_URL", "MOLLIE_API_KEY", "NEXTAUTH_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("webhookUrl", () => {
  it("derives the app's own webhook from the site URL by default", () => {
    delete process.env.MOLLIE_WEBHOOK_URL;
    process.env.NEXTAUTH_URL = "https://sofrapiwas.com";
    expect(webhookUrl()).toBe("https://sofrapiwas.com/api/webhooks/mollie");
  });

  it("honours the override on a test key — this is what makes an unmocked billing E2E possible", () => {
    // Mollie validates webhook reachability when a payment is created and 422s a
    // localhost URL, so without this no real payment could be created from a dev
    // machine or a CI runner at all.
    process.env.MOLLIE_API_KEY = "test_pretend";
    process.env.MOLLIE_WEBHOOK_URL = "https://example.com/sink";
    expect(webhookUrl()).toBe("https://example.com/sink");
  });

  it.each(["live_pretend", "", undefined])(
    "REFUSES the override when the key is %s — fails closed before any payment is created",
    (key) => {
      if (key === undefined) delete process.env.MOLLIE_API_KEY;
      else process.env.MOLLIE_API_KEY = key;
      process.env.MOLLIE_WEBHOOK_URL = "https://example.com/sink";
      // Throwing here means a misconfigured box refuses to TAKE money, rather than
      // taking it and stranding it where nothing will notice.
      expect(() => webhookUrl()).toThrow(/test-only override/i);
    },
  );

  it("ignores an empty override rather than treating it as set", () => {
    process.env.MOLLIE_API_KEY = "live_pretend";
    process.env.MOLLIE_WEBHOOK_URL = "";
    process.env.NEXTAUTH_URL = "https://sofrapiwas.com";
    // An empty string must read as "not overridden" — otherwise a blank env var in
    // a compose file would take a live tenant's billing down.
    expect(webhookUrl()).toBe("https://sofrapiwas.com/api/webhooks/mollie");
  });
});
