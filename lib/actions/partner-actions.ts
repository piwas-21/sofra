"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePartner } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { clientSchema, noteSchema, partnerStatusSchema } from "@/lib/validation";

/** `error` is a message key in the `control.errors` namespace, translated at
 *  render by <ActionError /> (control-plane i18n, sofra #9). */
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
  if (!parsed.success) return { error: "invalidClient" };
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
  if (!client) return { error: "clientNotFound" };

  const parsed = clientSchema.safeParse({
    restaurantName: formData.get("restaurantName"),
    contactName: formData.get("contactName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    city: formData.get("city") ?? "",
  });
  if (!parsed.success) return { error: "invalidClient" };
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
  if (!client) return { error: "clientNotFound" };
  // Pipeline is partner-editable only until onboarding is requested;
  // ONBOARDING/LIVE/CHURNED are controlled by the founder.
  if (["ONBOARDING", "LIVE", "CHURNED"].includes(client.status)) {
    return { error: "statusManaged" };
  }

  const parsed = partnerStatusSchema.safeParse(formData.get("status"));
  if (!parsed.success) return { error: "invalidStatus" };

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
  if (!client) return { error: "clientNotFound" };

  const parsed = noteSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) return { error: "invalidNote" };

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
  if (!client) return { error: "clientNotFound" };
  if (client.status !== "AGREED") {
    return { error: "notAgreed" };
  }

  await db.client.update({ where: { id: client.id }, data: { status: "ONBOARDING" } });
  await audit(partner.id, "client.onboarding_requested", "Client", id);

  const to = founderInbox();
  if (to) {
    await sendEmail({
      to,
      subject: `Sofra — Onboarding request: ${client.restaurantName}`,
      html: craftEmail({
        kicker: "Partner pipeline",
        title: "Onboarding requested",
        bodyHtml: detailRows([
          ["Restaurant", client.restaurantName],
          ["City", client.city ?? "—"],
          ["Contact", `${client.contactName ?? "—"} ${client.email ?? ""}`.trim()],
          ["Partner", `${partner.name} (${partner.email})`],
        ]),
        cta: { label: "Open admin", url: `${siteUrl()}/admin/clients` },
        footerNote: "Provision via the deploy-repo scripts, then mark LIVE.",
      }),
    });
  }

  revalidatePath(`/dashboard/clients/${id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
