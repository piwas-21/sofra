import { NextResponse } from "next/server";
import { sendEmail, founderInbox } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { guardIntake } from "@/lib/intake";

/**
 * Contact intake (demo / call / quote — the waitlist was retired 2026-07-06:
 * restaurants are onboarded directly). Sends a per-intent, craft-branded
 * notification to the founders' inbox via Resend. The route keeps its
 * /api/waitlist path so older deployed clients keep working.
 *
 * Env (all server-side):
 *   RESEND_API_KEY — required to actually send
 *   WAITLIST_TO    — destination inbox
 *   WAITLIST_FROM  — sender on a Resend-VERIFIED domain. REQUIRED: there is no
 *                    sandbox fallback, because that sender reaches only the Resend
 *                    account owner and 403s everyone else. Unset = nothing sends.
 *
 * RATE LIMITED (G17), through the same `guardIntake` the partner-apply and signup
 * intakes use — 5 POSTs per IP per 15 minutes. It is unauthenticated and it SENDS
 * MAIL on every accepted call, which makes an unlimited version two things at once:
 * a way to burn the Resend quota (and with it the invite and reset mails that share
 * it) and a way to flood the only inbox that reads these. The honeypot below stops
 * a naive bot, not a loop.
 */
const INTENTS: Record<string, { subject: string; kicker: string; title: string }> = {
  demo: { subject: "Demo request", kicker: "New request", title: "Someone wants a demo" },
  call: { subject: "Call request", kicker: "New request", title: "Someone wants a call" },
  quote: { subject: "Quote request", kicker: "New request", title: "Someone wants a quote" },
};

export async function POST(request: Request) {
  // Rate limit → JSON parse → the shared `company_website` honeypot. Its own
  // `company` honeypot is checked below and kept: this form has shipped with that
  // field name since the waitlist days, and every deployed client still sends it.
  const guarded = await guardIntake(request, "contact");
  if ("response" in guarded) return guarded.response;
  const body = guarded.body;

  const name = String(body.name ?? "").slice(0, 200).trim();
  const email = String(body.email ?? "").slice(0, 200).trim();
  const restaurant = String(body.restaurant ?? "").slice(0, 200).trim();
  const city = String(body.city ?? "").slice(0, 200).trim();
  const locale = String(body.locale ?? "en").slice(0, 5);
  const honeypot = String(body.company ?? "");
  const intent = INTENTS[String(body.intent ?? "")] ? String(body.intent) : "demo";

  // Bots fill the hidden field; pretend success and drop it.
  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !restaurant || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const to = founderInbox();
  if (!to) {
    console.error("contact: WAITLIST_TO not configured");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const meta = INTENTS[intent];
  const { sent } = await sendEmail({
    to,
    replyTo: email,
    subject: `SofraPiwas — ${meta.subject}: ${restaurant}`,
    html: craftEmail({
      kicker: meta.kicker,
      title: meta.title,
      bodyHtml: detailRows([
        ["Restaurant", restaurant],
        ["Name", name],
        ["Email", email],
        ["City", city || "—"],
        ["Language", locale],
      ]),
      footerNote: "Reply goes straight to the requester (reply-to is set).",
    }),
  });

  if (!sent) {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
