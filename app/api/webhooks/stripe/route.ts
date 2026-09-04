// Stripe Connect webhook (ADR-011 amendment, consequence 1 — "fee follows
// the refund"). ONE platform-level `connect: true` endpoint — Stripe REFUSES
// to let a platform register a webhook ON a connected account (measured) —
// so this file's whole job is routing: verify the signature, then act only
// on events that name a connected account via `event.account`.
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
import { verifyStripeSignature } from "@/lib/stripe-signature";
import { refundApplicationFeeForCharge } from "@/lib/stripe-fee-refund";

type StripeEvent = {
  id: string;
  type: string;
  // Present only on events scoped to a connected account — a platform-level
  // event (this endpoint acts on none of those) omits it entirely.
  account?: string;
  data: { object: { id: string } };
};

export async function POST(request: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!stripeConfigured() || !secret) {
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
  if (!verifyStripeSignature(rawBody, header, secret, Math.floor(Date.now() / 1000))) {
    // Bad or missing signature: process nothing past this point.
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
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
    console.error("stripe webhook: fee refund failed", event.id, e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
