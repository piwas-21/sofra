"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail } from "@/lib/email-templates";
import { createToken } from "@/lib/tokens";
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
  await sendEmail({
    to: user.email,
    subject: "Welcome to the Sofra partner program",
    html: craftEmail({
      kicker: "Partner program",
      title: "Welcome aboard 🎉",
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0;">Your Sofra partner application is approved. Set your password to open your partner dashboard — afiyet olsun.</p>`,
      cta: { label: "Set your password", url: inviteLink },
      footerNote: "The link works once and expires in 24 hours.",
    }),
  });
  await audit(admin.id, "application.approved", "PartnerApplication", id, { userId: user.id });

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
