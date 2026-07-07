// Mollie webhook (S9 — ADR-005/ADR-011 Job A). Mollie POSTs
// application/x-www-form-urlencoded `id=tr_...` with NO signature — the id is
// untrusted input, so the only safe move is to re-fetch the resource from the
// Mollie API and act on that (fetch-and-verify). Unknown ids and customers we
// don't track get a 200 so Mollie stops retrying.
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { mollieConfigured, getPayment, MollieError } from "@/lib/mollie";
import { recordPayment, MandateNotReadyError } from "@/lib/billing";

// Payment ids only — subscription charges also arrive as tr_ payment ids.
const PAYMENT_ID = /^tr_[A-Za-z0-9]{6,32}$/;

export async function POST(request: Request) {
  if (!mollieConfigured()) {
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }
  // Generous — Mollie retries per event; this only guards against floods.
  if (!rateLimit(`mollie-webhook:${clientIp(request)}`, 120, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let id = "";
  try {
    const form = await request.formData();
    id = String(form.get("id") ?? "");
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!PAYMENT_ID.test(id)) {
    // Not a payment id (or garbage) — acknowledge and ignore.
    return NextResponse.json({ ok: true });
  }

  try {
    const payment = await getPayment(id);
    await recordPayment(payment);
  } catch (e) {
    if (e instanceof MollieError && e.status === 404) {
      // Forged/unknown id — nothing to do.
      return NextResponse.json({ ok: true });
    }
    if (e instanceof MandateNotReadyError) {
      // Expected race: the paid first payment beat its mandate going valid.
      // 503 (not 200) — Mollie only redelivers on non-2xx, and this delivery
      // is the last one it sends on its own.
      console.warn("mollie webhook: mandate not ready yet, expecting retry", id);
      return NextResponse.json({ error: "mandate not ready" }, { status: 503 });
    }
    // Transient failure (Mollie/API/DB down): 5xx so Mollie retries later.
    console.error("mollie webhook: processing failed", id, e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
