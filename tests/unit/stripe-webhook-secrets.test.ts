import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyingScope, webhookSecrets } from "@/lib/stripe-webhook-secrets";

const CONNECT = "whsec_connect_endpoint";
const ACCOUNT = "whsec_account_endpoint";
const NOW = 1788558359;

/** A genuine Stripe-Signature for `body` under `secret` — same construction the
 *  API uses, so a passing test is not a test of our own re-implementation. */
const sign = (body: string, secret: string, t = NOW) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("webhookSecrets", () => {
  it("offers both scopes when both are configured, connect first", () => {
    expect(webhookSecrets({ connect: CONNECT, account: ACCOUNT })).toEqual([
      { scope: "connect", secret: CONNECT },
      { scope: "account", secret: ACCOUNT },
    ]);
  });

  it("either one alone is a working configuration", () => {
    expect(webhookSecrets({ connect: undefined, account: ACCOUNT })).toEqual([
      { scope: "account", secret: ACCOUNT },
    ]);
    expect(webhookSecrets({ connect: CONNECT, account: undefined })).toEqual([
      { scope: "connect", secret: CONNECT },
    ]);
  });

  it("neither configured yields an empty list — the route's 503", () => {
    expect(webhookSecrets({ connect: undefined, account: undefined })).toEqual([]);
  });

  it("a whitespace-only value is NOT configured", () => {
    // `SECRET= ` in a box .env is truthy in JS. Without the trim the endpoint
    // would answer 400 "invalid signature" instead of 503 "not configured", and
    // the fee-refund runbook's step 2 uses exactly that distinction to prove the
    // handler is set up before a charge is spent on it.
    expect(webhookSecrets({ connect: "  ", account: "\t" })).toEqual([]);
  });
});

describe("verifyingScope", () => {
  const body = '{"id":"evt_1","type":"application_fee.created"}';
  const secrets = webhookSecrets({ connect: CONNECT, account: ACCOUNT });

  it("names the ACCOUNT scope for a delivery signed by the account endpoint", () => {
    // The whole point of the second secret: this delivery is signed by neither
    // the first secret tried nor a rotation of it, and it must still be accepted.
    expect(verifyingScope({ rawBody: body, header: sign(body, ACCOUNT), secrets, nowSeconds: NOW }))
      .toBe("account");
  });

  it("names the CONNECT scope for a delivery signed by the connect endpoint", () => {
    expect(verifyingScope({ rawBody: body, header: sign(body, CONNECT), secrets, nowSeconds: NOW }))
      .toBe("connect");
  });

  it("returns null for a signature under neither secret", () => {
    expect(
      verifyingScope({ rawBody: body, header: sign(body, "whsec_wrong"), secrets, nowSeconds: NOW }),
    ).toBeNull();
  });

  it("returns null when the body does not match its own signature", () => {
    const header = sign(body, ACCOUNT);
    expect(
      verifyingScope({ rawBody: `${body} `, header, secrets, nowSeconds: NOW }),
    ).toBeNull();
  });

  it("does not accept an account-signed delivery when only connect is configured", () => {
    // The negative control on the whole feature: with one secret this is exactly
    // today's behaviour, so a green result above proves the SECOND secret did
    // the work and not some accident of the verifier.
    expect(
      verifyingScope({
        rawBody: body,
        header: sign(body, ACCOUNT),
        secrets: webhookSecrets({ connect: CONNECT, account: undefined }),
        nowSeconds: NOW,
      }),
    ).toBeNull();
  });

  it("returns null with no secrets at all", () => {
    expect(verifyingScope({ rawBody: body, header: sign(body, ACCOUNT), secrets: [], nowSeconds: NOW }))
      .toBeNull();
  });

  it("still enforces the replay window", () => {
    // Delegated to verifyStripeSignature, but asserted here so a future "try
    // every secret" refactor cannot quietly widen it.
    expect(
      verifyingScope({
        rawBody: body,
        header: sign(body, ACCOUNT, NOW - 3600),
        secrets,
        nowSeconds: NOW,
      }),
    ).toBeNull();
  });
});
