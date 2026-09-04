// Stripe webhook — ONE url, TWO Stripe endpoints, one handler.
//
// 1. The `connect: true` endpoint (ADR-011 amendment, consequence 1 — "fee
//    follows the refund"): Stripe REFUSES to let a platform register a webhook
//    ON a connected account (measured), so connected-account events arrive
//    platform-side and name their account via `event.account`.
// 2. An ACCOUNT-scoped (non-Connect) endpoint, for `application_fee.created`.
//    An ApplicationFee is a PLATFORM-owned object, so its event carries
//    `account: null` and a Connect endpoint NEVER receives it — measured, with
//    a control, in lib/stripe-webhook-secrets.ts. Stripe accepts the wrong
//    configuration (HTTP 200) and then silently never fires, which would make
//    "no earnings recorded" indistinguishable from "no commission earned yet".
//
// Each endpoint has its own `whsec_`, so a delivery is verified against every
// configured secret and the scope that verified it is what the logs name.
//
// Deliberately NOT handled: `application_fee.refunded` /
// `application_fee.refund.updated`. The refunded side is already recorded by
// our own write path (lib/stripe-fee-refund.ts); a second source for the same
// fact is a reconciliation problem, not a feature. And `charge.refunded` can
// be processed BEFORE `application_fee.created` for a fast refund (the fee is
// created asynchronously — the runbook measured "within 5s"), which is safe
// only because the two tables are independent writers joined at read time. The
// natural next change — "look up the earned row while writing a refund" —
// would break exactly that.
//
// Every other Connect event type is deliberately left unhandled (ack 200, do
// nothing), not merely unimplemented:
//  - `charge.dispute.*` is OUT OF SCOPE on purpose. For a Direct charge on a
//    Standard connected account, dispute LIABILITY sits with the connected
//    account, and whether Stripe reverses the application fee on a dispute
//    is UNVERIFIED. Guessing here risks Sofra money on an untested branch;
//    not handling it costs nothing today (the dispute is still visible in
//    the connected account's own Stripe dashboard) and can be added once the
//    behaviour is actually measured.
//  - everything else Connect can send (account.updated, payout.*, …) is
//    simply not this endpoint's job.
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { stripeConfigured, StripeError } from "@/lib/stripe";
import { verifyingScope, webhookSecrets } from "@/lib/stripe-webhook-secrets";
import { refundApplicationFeeForCharge } from "@/lib/stripe-fee-refund";
import { recordApplicationFee } from "@/lib/stripe-fee-earned";

type StripeEvent = {
  id: string;
  type: string;
  // Present only on events scoped to a connected account. A PLATFORM-level
  // event omits it entirely — `application_fee.created` is one, which is
  // exactly why its branch runs before the `!event.account` guard.
  account?: string;
  data: { object: { id: string } };
};

export async function POST(request: Request) {
  // BOTH endpoints post here. Either secret alone is a working configuration —
  // one rail on, the other silent — so this 503s only when NEITHER is set.
  const secrets = webhookSecrets({
    connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    account: process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET,
  });
  if (!stripeConfigured() || secrets.length === 0) {
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }
  // Generous — Stripe retries per event; this only guards against floods
  // (mirrors the Mollie webhook's own limit).
  if (!rateLimit(`stripe-webhook:${clientIp(request)}`, 120, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  // RAW bytes only, read BEFORE any parsing — the signature is computed over
  // the exact body Stripe sent, and `request.json()` would re-serialize it
  // and silently break every verification.
  const rawBody = await request.text();
  const header = request.headers.get("stripe-signature") ?? "";
  const scope = verifyingScope({
    rawBody,
    header,
    secrets,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!scope) {
    // Bad or missing signature: process nothing past this point. The log names
    // the secrets that were actually tried, so "the account endpoint's secret is
    // wrong" stays distinguishable from "only the Connect secret is configured
    // at all" — the second is a box .env omission and looks identical otherwise.
    console.warn(
      "stripe webhook: no configured secret verified this delivery; tried",
      secrets.map((s) => s.scope).join(","),
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  // ABOVE the account guard on purpose: `application_fee.created` has NO
  // `event.account` (measured), so the guard below would discard it. The
  // connected account is read from the FEE object instead, which is also what
  // makes this branch independent of which endpoint delivered the event.
  if (event.type === "application_fee.created") {
    try {
      await recordApplicationFee(event.data.object.id);
    } catch (e) {
      if (e instanceof StripeError && e.status === 404) {
        return NextResponse.json({ ok: true });
      }
      console.error("stripe webhook: fee record failed", scope, event.id, e);
      return NextResponse.json({ error: "processing failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!event.account) {
    // A platform-level event, not a connected-account one — acknowledge and
    // ignore rather than guess at what it might mean.
    return NextResponse.json({ ok: true });
  }
  if (event.type !== "charge.refunded") {
    return NextResponse.json({ ok: true });
  }

  try {
    await refundApplicationFeeForCharge(event.account, event.data.object.id);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) {
      // Forged/unknown id, or a database restored across environments —
      // nothing to do.
      return NextResponse.json({ ok: true });
    }
    // Transient failure (Stripe/API/DB down): 5xx so Stripe retries later.
    console.error("stripe webhook: fee refund failed", scope, event.id, e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
