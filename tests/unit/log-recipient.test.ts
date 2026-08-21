import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_RECIPIENT, recipientTag, redactAddresses } from "@/lib/log-recipient";

// Pure module (node:crypto only). The env key is saved/restored per case, as in
// email.test.ts / tenant-registry.test.ts — never reassign process.env wholesale.

const savedSalt = process.env.LOG_HASH_SALT;

describe("recipientTag", () => {
  beforeEach(() => {
    process.env.LOG_HASH_SALT = "test-salt";
  });
  afterEach(() => {
    if (savedSalt === undefined) delete process.env.LOG_HASH_SALT;
    else process.env.LOG_HASH_SALT = savedSalt;
  });

  it("never contains the address, the local part, or the domain", () => {
    const tag = recipientTag("owner@kebabhouse.ch");
    expect(tag).not.toContain("owner");
    expect(tag).not.toContain("kebabhouse");
    expect(tag).not.toContain("@");
  });

  it("is stable for the same address, so two log lines are recognisably one person", () => {
    expect(recipientTag("owner@kebabhouse.ch")).toBe(recipientTag("owner@kebabhouse.ch"));
  });

  it("normalises case and surrounding whitespace", () => {
    expect(recipientTag("  Owner@KebabHouse.CH ")).toBe(recipientTag("owner@kebabhouse.ch"));
  });

  it("distinguishes two addresses at the same domain", () => {
    expect(recipientTag("a@example.com")).not.toBe(recipientTag("b@example.com"));
  });

  it("depends on the salt — the same address tags differently under another one", () => {
    const withTest = recipientTag("owner@kebabhouse.ch");
    process.env.LOG_HASH_SALT = "another-salt";
    expect(recipientTag("owner@kebabhouse.ch")).not.toBe(withTest);
  });

  it("says (none) for an absent address rather than digesting the empty string", () => {
    // A tag here would assert a recipient that never existed, which is the one
    // thing worse than a missing one when reading back a failed send.
    expect(recipientTag("")).toBe(NO_RECIPIENT);
    expect(recipientTag("   ")).toBe(NO_RECIPIENT);
    expect(recipientTag(null)).toBe(NO_RECIPIENT);
    expect(recipientTag(undefined)).toBe(NO_RECIPIENT);
  });

  it("still tags a value that is not a well-formed address", () => {
    // sendEmail is not a validator; whatever it was handed is what must not be logged.
    expect(recipientTag("not-an-address")).not.toBe(NO_RECIPIENT);
    expect(recipientTag("not-an-address")).not.toContain("not-an-address");
  });
});

describe("redactAddresses (provider text we did not write)", () => {
  beforeEach(() => {
    process.env.LOG_HASH_SALT = "test-salt";
  });
  afterEach(() => {
    if (savedSalt === undefined) delete process.env.LOG_HASH_SALT;
    else process.env.LOG_HASH_SALT = savedSalt;
  });

  it("removes the address from Resend's real sandbox-sender 403", () => {
    const body = JSON.stringify({
      statusCode: 403,
      message:
        "You can only send testing emails to your own email address (mahmutkaya.nl@gmail.com). " +
        "To send emails to other recipients, please verify a domain.",
    });
    const out = redactAddresses(body);
    expect(out).not.toContain("mahmutkaya.nl@gmail.com");
    expect(out).toContain(recipientTag("mahmutkaya.nl@gmail.com"));
    // The diagnosis survives — the whole point of logging the body at all.
    expect(out).toContain("please verify a domain");
    expect(out).toContain("403");
  });

  it("redacts every address, not only the first", () => {
    const out = redactAddresses("to a@example.com and b@example.org failed");
    expect(out).not.toContain("a@example.com");
    expect(out).not.toContain("b@example.org");
    expect(out).toContain(recipientTag("a@example.com"));
    expect(out).toContain(recipientTag("b@example.org"));
  });

  it("gives the same address the same tag as recipientTag does", () => {
    // Otherwise the refusal line and the provider line describe one recipient
    // with two different tags, which is worse than not tagging at all.
    expect(redactAddresses("owner@kebabhouse.ch")).toBe(recipientTag("owner@kebabhouse.ch"));
  });

  it("leaves text with no address untouched", () => {
    expect(redactAddresses("rate limit exceeded")).toBe("rate limit exceeded");
    expect(redactAddresses("")).toBe("");
  });

  it("does not eat the punctuation an address is quoted inside", () => {
    const out = redactAddresses('address "owner@kebabhouse.ch", rejected');
    expect(out).toContain('"');
    expect(out).toContain(", rejected");
    expect(out).not.toContain("kebabhouse");
  });
});

describe("redactAddresses — the regex is pointed at text we do not control", () => {
  it("does not backtrack catastrophically on a long adversarial run", () => {
    // The pattern this replaced was super-linear (Sonar S8786) and ran on a
    // provider's response body. A pathological input must stay fast, so this is
    // an assertion about TIME, which is the only way that property is visible.
    // The measured numbers, for whoever changes this next: an address-shaped
    // regex took ~1.9s on these two inputs; the token scan takes single-digit ms.
    const hostile = `${"a".repeat(50_000)}!`;
    const started = Date.now();
    redactAddresses(hostile);
    redactAddresses(`${hostile}@${hostile}`);
    expect(Date.now() - started).toBeLessThan(250);
  });

it("stays fast on a token that is nothing but punctuation", async () => {
    // The anchored `[…]+$` this replaced retried from every offset, so a long run
    // of quotes and commas was quadratic — reachable from a provider body, which
    // is text we do not write and do not bound.
    const punctuation = '"'.repeat(50_000);
    const started = Date.now();
    redactAddresses(punctuation);
    redactAddresses(`${punctuation}owner@example.com${punctuation}`);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("leaves an @mention alone — it is not an address and a digest would only hurt", () => {
    expect(redactAddresses("cc @here about the 403")).toBe("cc @here about the 403");
  });

  it("redacts an address wrapped in angle brackets, keeping the brackets", () => {
    const out = redactAddresses("From: Sofra <sofra@send.sofrapiwas.com>");
    expect(out).toContain("<");
    expect(out).toContain(">");
    expect(out).not.toContain("send.sofrapiwas.com");
  });
});
