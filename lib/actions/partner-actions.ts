"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, escapeHtml, founderInbox, siteUrl } from "@/lib/email";
import { clientSchema, noteSchema, partnerStatusSchema } from "@/lib/validation";

export type PartnerActionState = { error?: string; ok?: boolean };

/** Loads a client iff it belongs to the calling partner — the ONLY way
 *  partner actions may touch a client row. */
async function ownClient(partnerId: string, clientId: string) {
  return db.client.findFirst({ where: { id: clientId, partnerId } });
}

export async function createClientAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  const partner = await requirePartner();

  const parsed = clientSchema.safeParse({
    restaurantName: formData.get("restaurantName"),
    contactName: formData.get("contactName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    city: formData.get("city") ?? "",
  });
  if (!parsed.success) return { error: "Restaurant name is required (email must be valid)." };
  const data = parsed.data;

  const client = await db.client.create({
    data: {
      partnerId: partner.id,
      restaurantName: data.restaurantName,
      contactName: data.contactName || null,
      email: data.email || null,
      phone: data.phone || null,
      city: data.city || null,
    },
  });
  await audit(partner.id, "client.created", "Client", client.id);

  revalidatePath("/dashboard");
  redirect(`/dashboard/clients/${client.id}`);
}

export async function updateClientAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  const partner = await requirePartner();
  const id = String(formData.get("id") ?? "");
  const client = await ownClient(partner.id, id);
  if (!client) return { error: "Client not found." };

  const parsed = clientSchema.safeParse({
    restaurantName: formData.get("restaurantName"),
    contactName: formData.get("contactName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    city: formData.get("city") ?? "",
  });
  if (!parsed.success) return { error: "Restaurant name is required (email must be valid)." };
  const data = parsed.data;

  await db.client.update({
    where: { id: client.id },
    data: {
      restaurantName: data.restaurantName,
      contactName: data.contactName || null,
      email: data.email || null,
      phone: data.phone || null,
      city: data.city || null,
    },
  });

  revalidatePath(`/dashboard/clients/${id}`);
  return { ok: true };
}

export async function setClientStatusAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  const partner = await requirePartner();
  const id = String(formData.get("id") ?? "");
  const client = await ownClient(partner.id, id);
  if (!client) return { error: "Client not found." };
  // Pipeline is partner-editable only until onboarding is requested;
  // ONBOARDING/LIVE/CHURNED are controlled by the founder.
  if (["ONBOARDING", "LIVE", "CHURNED"].includes(client.status)) {
    return { error: "This client's status is managed by Sofra now." };
  }

  const parsed = partnerStatusSchema.safeParse(formData.get("status"));
  if (!parsed.success) return { error: "Invalid status." };

  await db.client.update({ where: { id: client.id }, data: { status: parsed.data } });
  await audit(partner.id, "client.status", "Client", id, { status: parsed.data });

  revalidatePath(`/dashboard/clients/${id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function addNoteAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  const partner = await requirePartner();
  const id = String(formData.get("id") ?? "");
  const client = await ownClient(partner.id, id);
  if (!client) return { error: "Client not found." };

  const parsed = noteSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) return { error: "Note can't be empty (max 2000 chars)." };

  await db.clientNote.create({
    data: { clientId: client.id, authorId: partner.id, body: parsed.data.body },
  });

  revalidatePath(`/dashboard/clients/${id}`);
  return { ok: true };
}

/** AGREED → ONBOARDING + notify the founder (provisioning stays founder-run). */
export async function requestOnboardingAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  const partner = await requirePartner();
  const id = String(formData.get("id") ?? "");
  const client = await ownClient(partner.id, id);
  if (!client) return { error: "Client not found." };
  if (client.status !== "AGREED") {
    return { error: "Move the client to “Agreed” first." };
  }

  await db.client.update({ where: { id: client.id }, data: { status: "ONBOARDING" } });
  await audit(partner.id, "client.onboarding_requested", "Client", id);

  const to = founderInbox();
  if (to) {
    await sendEmail({
      to,
      subject: `Sofra onboarding request: ${client.restaurantName}`,
      html: `<h2>Onboarding requested</h2>
<ul>
  <li><b>Restaurant:</b> ${escapeHtml(client.restaurantName)}</li>
  <li><b>City:</b> ${escapeHtml(client.city ?? "—")}</li>
  <li><b>Contact:</b> ${escapeHtml(client.contactName ?? "—")} ${escapeHtml(client.email ?? "")}</li>
  <li><b>Partner:</b> ${escapeHtml(partner.name)} (${escapeHtml(partner.email)})</li>
</ul>
<p><a href="${siteUrl()}/admin/clients">Open admin</a> — provision via the deploy-repo scripts, then mark LIVE.</p>`,
    });
  }

  revalidatePath(`/dashboard/clients/${id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
