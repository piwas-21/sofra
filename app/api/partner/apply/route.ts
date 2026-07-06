import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, escapeHtml, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
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
      subject: `Sofra — Partner application: ${data.name}`,
      html: craftEmail({
        kicker: "Partner program",
        title: "New partner application",
        bodyHtml: `${detailRows([
          ["Name", data.name],
          ["Email", data.email],
          ["Company", data.company || "—"],
          ["City", data.city || "—"],
          ["Language", data.locale],
        ])}<p style="margin:12px 0 0;">${escapeHtml(data.message)}</p>`,
        cta: { label: "Review in admin", url: `${siteUrl()}/admin` },
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
