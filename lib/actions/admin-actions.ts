"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { createToken } from "@/lib/tokens";
import { commissionSchema } from "@/lib/validation";

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
    return { error: "Application not found or already decided." };
  }
  if (await db.user.findUnique({ where: { email: application.email } })) {
    return { error: "A user with this email already exists." };
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
    html: `<p>Hi ${escapeHtml(user.name)},</p>
<p>Your Sofra partner application is approved — welcome aboard.</p>
<p><a href="${inviteLink}">Set your password</a> to open your partner dashboard.
The link works once and expires in 24 hours.</p>
<p>Afiyet olsun,<br/>Sofra</p>`,
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
    return { error: "Application not found or already decided." };
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
    return { error: "Tenant slug: lowercase letters, digits, dashes." };
  }
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return { error: "Client not found." };

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
  if (!client) return { error: "Client not found." };

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
  if (!parsed.success) return { error: "Check the amount and note." };
  const data = parsed.data;

  const partner = await db.user.findUnique({ where: { id: data.partnerId } });
  if (!partner || partner.role !== "PARTNER") return { error: "Partner not found." };
  if (data.clientId) {
    const client = await db.client.findUnique({ where: { id: data.clientId } });
    if (!client || client.partnerId !== partner.id) {
      return { error: "Client doesn't belong to this partner." };
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
