import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail, escapeHtml, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { guardIntake } from "@/lib/intake";
import { applySchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

/**
 * Public "Become a partner" intake. Shares the honeypot + rate-limit guard with
 * the signup route (guardIntake); applications land in the founder admin queue
 * AND the founder inbox.
 */
export async function POST(request: Request) {
  const guard = await guardIntake(request, "apply");
  if ("response" in guard) return guard.response;

  const parsed = applySchema.safeParse(guard.body);
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
