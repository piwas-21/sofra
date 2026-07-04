import { NextResponse } from "next/server";

/**
 * Waitlist intake. Sends the signup to the founders' inbox via the Resend
 * HTTP API (same provider the RUMI backend uses; Netcup blocks SMTP).
 *
 * Env (all server-side):
 *   RESEND_API_KEY — required to actually send
 *   WAITLIST_TO    — destination inbox
 *   WAITLIST_FROM  — verified sender (falls back to Resend's onboarding sender)
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const name = String(body.name ?? "").slice(0, 200).trim();
  const email = String(body.email ?? "").slice(0, 200).trim();
  const restaurant = String(body.restaurant ?? "").slice(0, 200).trim();
  const city = String(body.city ?? "").slice(0, 200).trim();
  const locale = String(body.locale ?? "en").slice(0, 5);
  const honeypot = String(body.company ?? "");

  // Bots fill the hidden field; pretend success and drop it.
  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !restaurant || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.WAITLIST_TO;
  if (!apiKey || !to) {
    console.error("waitlist: RESEND_API_KEY / WAITLIST_TO not configured");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.WAITLIST_FROM ?? "Sofra Waitlist <onboarding@resend.dev>",
      to: [to],
      reply_to: email,
      subject: `Sofra waitlist: ${restaurant}`,
      html: `<h2>New waitlist signup</h2>
<ul>
  <li><b>Name:</b> ${escape(name)}</li>
  <li><b>Email:</b> ${escape(email)}</li>
  <li><b>Restaurant:</b> ${escape(restaurant)}</li>
  <li><b>City:</b> ${escape(city)}</li>
  <li><b>Locale:</b> ${escape(locale)}</li>
</ul>`,
    }),
  });

  if (!res.ok) {
    console.error("waitlist: resend failed", res.status, await res.text());
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
