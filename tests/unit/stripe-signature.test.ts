import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNATURE_TOLERANCE_SECONDS, verifyStripeSignature } from "@/lib/stripe-signature";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"charge.refunded"}';
const NOW = 1_700_000_000;

function sign(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function header(timestamp: number, ...v1s: string[]): string {
  return [`t=${timestamp}`, ...v1s.map((v1) => `v1=${v1}`)].join(",");
}

describe("verifyStripeSignature", () => {
  it("accepts a valid signature", () => {
    const v1 = sign(SECRET, NOW, BODY);
    expect(verifyStripeSignature(BODY, header(NOW, v1), SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const v1 = sign(SECRET, NOW, BODY);
    const tampered = BODY.replace("charge.refunded", "charge.succeeded");
    expect(verifyStripeSignature(tampered, header(NOW, v1), SECRET, NOW)).toBe(false);
  });

  it("rejects an expired timestamp", () => {
    const staleAt = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
    const v1 = sign(SECRET, staleAt, BODY);
    expect(verifyStripeSignature(BODY, header(staleAt, v1), SECRET, NOW)).toBe(false);
  });

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const boundary = NOW - SIGNATURE_TOLERANCE_SECONDS;
    const v1 = sign(SECRET, boundary, BODY);
    expect(verifyStripeSignature(BODY, header(boundary, v1), SECRET, NOW)).toBe(true);
  });

  it("rejects a timestamp from the future beyond tolerance too — a replay guard, not just an expiry check", () => {
    const future = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
    const v1 = sign(SECRET, future, BODY);
    expect(verifyStripeSignature(BODY, header(future, v1), SECRET, NOW)).toBe(false);
  });

  it("accepts when ANY of multiple v1 values matches — the secret-rotation case", () => {
    const wrong = sign("whsec_previous_secret_wrong", NOW, BODY);
    const right = sign(SECRET, NOW, BODY);
    expect(verifyStripeSignature(BODY, header(NOW, wrong, right), SECRET, NOW)).toBe(true);
  });

  it("rejects when no v1 value matches", () => {
    const wrongA = sign("whsec_a", NOW, BODY);
    const wrongB = sign("whsec_b", NOW, BODY);
    expect(verifyStripeSignature(BODY, header(NOW, wrongA, wrongB), SECRET, NOW)).toBe(false);
  });

  it("rejects a missing or malformed header without throwing", () => {
    expect(verifyStripeSignature(BODY, "", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, "garbage", SECRET, NOW)).toBe(false);
    expect(() => verifyStripeSignature(BODY, "t=notanumber,v1=abc", SECRET, NOW)).not.toThrow();
  });

  it("does not throw on a v1 value of the wrong length", () => {
    expect(() => verifyStripeSignature(BODY, header(NOW, "x".repeat(4096)), SECRET, NOW)).not.toThrow();
    expect(verifyStripeSignature(BODY, header(NOW, "x".repeat(4096)), SECRET, NOW)).toBe(false);
  });

  it("ignores an unrecognized key (Stripe's deprecated v0 scheme) and still validates on v1", () => {
    const v1 = sign(SECRET, NOW, BODY);
    const withV0 = `v0=${"deadbeef".repeat(8)},${header(NOW, v1)}`;
    expect(verifyStripeSignature(BODY, withV0, SECRET, NOW)).toBe(true);
  });

  it("rejects an empty t or v1 value without throwing", () => {
    expect(verifyStripeSignature(BODY, `t=,v1=${sign(SECRET, NOW, BODY)}`, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=`, SECRET, NOW)).toBe(false);
  });
});
