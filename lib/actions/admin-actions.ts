"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail } from "@/lib/email-templates";
import { createToken } from "@/lib/tokens";
import { emailTranslator } from "@/lib/email-locale";
import { commissionSchema } from "@/lib/validation";

/** `error` is a message key in the `control.errors` namespace, translated at
 *  render by <ActionError /> (control-plane i18n, sofra #9). */
export type AdminActionState = { error?: string; ok?: boolean; inviteLink?: string };

/**
 * Approve an application: create the PARTNER user + profile, mint a
 * set-password invite, email it — and ALWAYS return the link so the founder
 * can pass it on manually if email delivery hiccups.
 */
export async function approveApplicationAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");

  const application = await db.partnerApplication.findUnique({ where: { id } });
  if (!application || application.status !== "PENDING") {
    return { error: "applicationDecided" };
  }
  if (await db.user.findUnique({ where: { email: application.email } })) {
    return { error: "userExists" };
  }

  const user = await db.user.create({
    data: {
      email: application.email,
      name: application.name,
      role: "PARTNER",
      status: "INVITED",
      // The language they applied in (G9). The application row is a lead and gets
      // left behind; the account is what every later mail is addressed to.
      locale: application.locale,
      profile: {
        create: { company: application.company, city: application.city },
      },
    },
  });
  await db.partnerApplication.update({
    where: { id },
    data: { status: "APPROVED", decidedAt: new Date() },
  });

  const raw = await createToken(user.id, "invite");
  const inviteLink = `${siteUrl()}/invite/${raw}`;
  // The verdict is kept, not discarded (G16). This mail is the partner's ONLY way into an account
  // that has no password, and `sendEmail` reports a failure by returning rather than throwing — so
  // without recording it, an approval that mailed nobody looks exactly like one that worked. The
  // link is returned to this very screen, so the founder can still hand it over; they just have to
  // be told they need to.
  // In the language they APPLIED in (G9): the application row holds it, and this
  // is the first thing we ever send them.
  const t = await emailTranslator(user.locale, "emails.partnerApproved");
  const invite = await sendEmail({
    to: user.email,
    subject: t("subject"),
    html: craftEmail({
      kicker: t("kicker"),
      title: t("title"),
      bodyHtml: `<p style="margin:0 0 12px;">${t("greeting", { name: escapeHtml(user.name) })}</p>
<p style="margin:0;">${t("lead")}</p>`,
      cta: { label: t("cta"), url: inviteLink },
      footerNote: t("footerNote"),
    }),
    // `sendEmail` swallows a non-2xx into {sent:false}, but `fetch` itself REJECTS on a DNS or
    // connect failure — and letting that escape would throw AFTER the account and the token exist,
    // taking `inviteLink` with it. The raw token is unrecoverable and a second approval trips the
    // "user exists" guard, so that failure would be unrecoverable too. Caught, recorded, link
    // returned — which is what makes the comment above true.
  }).catch(() => ({ sent: false }));
  await audit(admin.id, "application.approved", "PartnerApplication", id, {
    userId: user.id,
    emailed: invite.sent,
  });

  revalidatePath("/admin");
  return { ok: true, inviteLink };
}

export async function rejectApplicationAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");

  const application = await db.partnerApplication.findUnique({ where: { id } });
  if (!application || application.status !== "PENDING") {
    return { error: "applicationDecided" };
  }
  await db.partnerApplication.update({
    where: { id },
    data: { status: "REJECTED", decidedAt: new Date() },
  });
  await audit(admin.id, "application.rejected", "PartnerApplication", id);

  revalidatePath("/admin");
  return { ok: true };
}

/** Founder marks a client provisioned: tenant slug + LIVE (ADMIN-only by design). */
export async function setClientLiveAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const tenantSlug = String(formData.get("tenantSlug") ?? "").trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(tenantSlug)) {
    return { error: "invalidSlug" };
  }
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return { error: "clientNotFound" };

  const taken = await db.client.findUnique({ where: { tenantSlug } });
  if (taken && taken.id !== id) {
    return { error: "slugTaken" };
  }
  await db.client.update({ where: { id }, data: { tenantSlug, status: "LIVE" } });
  await audit(admin.id, "client.live", "Client", id, { tenantSlug });

  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function markClientChurnedAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return { error: "clientNotFound" };

  await db.client.update({ where: { id }, data: { status: "CHURNED" } });
  await audit(admin.id, "client.churned", "Client", id);

  revalidatePath("/admin/clients");
  return { ok: true };
}

/** Manual commission ledger entry (P-D3: founder-recorded in v1). */
export async function addCommissionAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();

  const parsed = commissionSchema.safeParse({
    partnerId: formData.get("partnerId"),
    clientId: formData.get("clientId") ?? "",
    amount: formData.get("amount"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: "invalidCommission" };
  const data = parsed.data;

  const partner = await db.user.findUnique({ where: { id: data.partnerId } });
  if (!partner || partner.role !== "PARTNER") return { error: "partnerNotFound" };
  if (data.clientId) {
    const client = await db.client.findUnique({ where: { id: data.clientId } });
    if (!client || client.partnerId !== partner.id) {
      return { error: "clientNotOwned" };
    }
  }

  const entry = await db.commissionEntry.create({
    data: {
      partnerId: data.partnerId,
      clientId: data.clientId || null,
      amountCents: Math.round(data.amount * 100),
      note: data.note,
      createdById: admin.id,
    },
  });
  await audit(admin.id, "commission.recorded", "CommissionEntry", entry.id, {
    partnerId: data.partnerId,
    amountCents: entry.amountCents,
  });

  revalidatePath(`/admin/partners/${data.partnerId}`);
  return { ok: true };
}
