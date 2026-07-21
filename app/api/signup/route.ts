import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, escapeHtml, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { guardIntake } from "@/lib/intake";
import { signupSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

/**
 * Public direct-restaurant signup intake (ADR-004 self-serve v1). Shares the
 * partner-apply guards (honeypot, rate limit) via guardIntake; leads land in the
 * founder admin queue (SignupRequest, status NEW) AND the founder inbox. The
 * founder converts a lead via /admin/onboard — no auto-provisioning yet.
 */
export async function POST(request: Request) {
  const guard = await guardIntake(request, "signup");
  if ("response" in guard) return guard.response;

  const parsed = signupSchema.safeParse(guard.body);
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
    const messageHtml = data.message
      ? `<p style="margin:12px 0 0;">${escapeHtml(data.message)}</p>`
      : "";
    await sendEmail({
      to,
      replyTo: data.email,
      subject: `SofraPiwas — New signup: ${data.restaurantName}`,
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
        ])}${messageHtml}`,
        cta: { label: "Review in admin", url: `${siteUrl()}/admin` },
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
