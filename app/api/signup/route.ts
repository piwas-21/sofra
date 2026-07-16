import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, escapeHtml, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { signupSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

/**
 * Public direct-restaurant signup intake (ADR-004 self-serve v1). Same guards as
 * the partner-apply route (honeypot, rate limit, escaping); leads land in the
 * founder admin queue (SignupRequest, status NEW) AND the founder inbox. The
 * founder converts a lead via /admin/onboard — no auto-provisioning yet.
 */
export async function POST(request: Request) {
  if (!rateLimit(`signup:${clientIp(request)}`, 5, 15 * 60 * 1000)) {
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

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const data = parsed.data;

  const signup = await db.signupRequest.create({
    data: {
      restaurantName: data.restaurantName,
      contactName: data.contactName,
      email: data.email.toLowerCase(),
      phone: data.phone || null,
      city: data.city || null,
      desiredSlug: data.desiredSlug || null,
      message: data.message || null,
      locale: data.locale,
    },
  });
  await audit(null, "signup.requested", "SignupRequest", signup.id);

  const to = founderInbox();
  if (to) {
    await sendEmail({
      to,
      replyTo: data.email,
      subject: `Sofra — New signup: ${data.restaurantName}`,
      html: craftEmail({
        kicker: "Signups",
        title: "New restaurant signup",
        bodyHtml: `${detailRows([
          ["Restaurant", data.restaurantName],
          ["Contact", data.contactName],
          ["Email", data.email],
          ["Phone", data.phone || "—"],
          ["City", data.city || "—"],
          ["Desired slug", data.desiredSlug || "—"],
          ["Language", data.locale],
        ])}${data.message ? `<p style="margin:12px 0 0;">${escapeHtml(data.message)}</p>` : ""}`,
        cta: { label: "Review in admin", url: `${siteUrl()}/admin` },
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
