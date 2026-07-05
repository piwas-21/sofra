import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, escapeHtml, founderInbox, siteUrl } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { applySchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

/**
 * Public "Become a partner" intake. Same guards as the waitlist route
 * (honeypot, caps, escaping) plus rate limiting; applications land in the
 * founder admin queue AND the founder inbox.
 */
export async function POST(request: Request) {
  if (!rateLimit(`apply:${clientIp(request)}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Bots fill the hidden field; pretend success and drop it.
  if (String(body.company_website ?? "")) {
    return NextResponse.json({ ok: true });
  }

  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const data = parsed.data;

  const application = await db.partnerApplication.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      company: data.company || null,
      city: data.city || null,
      message: data.message,
      locale: data.locale,
    },
  });
  await audit(null, "partner.applied", "PartnerApplication", application.id);

  const to = founderInbox();
  if (to) {
    await sendEmail({
      to,
      replyTo: data.email,
      subject: `Sofra partner application: ${data.name}`,
      html: `<h2>New partner application</h2>
<ul>
  <li><b>Name:</b> ${escapeHtml(data.name)}</li>
  <li><b>Email:</b> ${escapeHtml(data.email)}</li>
  <li><b>Company:</b> ${escapeHtml(data.company || "—")}</li>
  <li><b>City:</b> ${escapeHtml(data.city || "—")}</li>
  <li><b>Locale:</b> ${escapeHtml(data.locale)}</li>
</ul>
<p>${escapeHtml(data.message)}</p>
<p><a href="${siteUrl()}/admin">Review in admin</a></p>`,
    });
  }

  return NextResponse.json({ ok: true });
}
