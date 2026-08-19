"use server";

// The partner's one WRITE against a tenant they have sold (SOFRA-PARTNER-PLAN §9).
//
// Once a client is ONBOARDING/LIVE the pipeline is founder-managed (ADR-003/007: the
// registry is edited in the deploy repo, in a PR, by the founder — never from this
// app). That is a deliberate boundary and this action does not cross it: it adds no
// partner write to the registry, to modules, or to the plan. What it adds is the thing
// that was missing on the other side of the boundary — a way for the person who owns
// the commercial relationship to ASK, in one place, and have the ask land somewhere
// durable instead of in a WhatsApp message the founder loses.
//
// Modelled on `requestOnboardingAction`, including the two things that were learned
// there: the send is `.catch()`ed (a `fetch` rejection would otherwise lose the audit
// row after the note had already committed), and the audit row is written AFTER the
// send so it carries the outcome.

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ownClient } from "@/lib/client-access";
import { sendEmail, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { noteSchema } from "@/lib/validation";

/** `error` is a message key in `control.errors`, translated by <ActionError />. */
export type ChangeRequestState = { error?: string; ok?: boolean };

/**
 * "Request a change" on a client — an upsell, a module change, anything.
 *
 * Recorded as a `ClientNote` FIRST, because the note is the durable artefact: it is
 * visible to the partner on the same page they typed it, and to the founder on
 * /admin/clients, whether or not any mail was ever delivered. The body is stored
 * VERBATIM — no synthesised prefix — because a prefix written here would be an English
 * string on a surface that is translated six ways, and the audit row already carries
 * the distinction between a note and a request.
 *
 * Rate-limited per partner: this is the only authenticated path in the control plane
 * that sends founder mail on free text, and an unbounded one is a way to burn the
 * sending domain's reputation from inside a logged-in session. `partner.id` beats IP
 * for the same reason `startPaymentAction` uses it — no NAT collisions, no proxy
 * header to spoof.
 */
export async function requestClientChangeAction(
  _prev: ChangeRequestState,
  formData: FormData,
): Promise<ChangeRequestState> {
  const partner = await requirePartner();
  const id = String(formData.get("id") ?? "");
  const client = await ownClient(partner.id, id);
  if (!client) return { error: "clientNotFound" };

  const parsed = noteSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) return { error: "invalidNote" };

  if (!rateLimit(`client-change:${partner.id}`, 10, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  await db.clientNote.create({
    data: { clientId: client.id, authorId: partner.id, body: parsed.data.body },
  });

  const to = founderInbox();
  let emailed = false;

  if (to) {
    // Caught, like every send on an already-committed path: the note is written, and
    // letting a DNS/connect rejection escape would lose the audit row below.
    const notice = await sendEmail({
      to,
      subject: `SofraPiwas — Change requested: ${client.restaurantName}`,
      html: craftEmail({
        kicker: "Partner pipeline",
        title: "A partner asked for a change",
        // Every value is escaped by `detailRows` — this one carries free text a
        // partner typed, which is the only place in this mail that is not ours.
        bodyHtml: detailRows([
          ["Restaurant", client.restaurantName],
          ["Tenant", client.tenantSlug ?? "—"],
          ["Status", client.status],
          ["Partner", `${partner.name} (${partner.email})`],
          ["Request", parsed.data.body],
        ]),
        cta: { label: "Open admin", url: `${siteUrl()}/admin/clients` },
        footerNote: "Registry and module changes stay founder-run (ADR-003/007).",
      }),
    }).catch(() => ({ sent: false }));

    emailed = notice.sent;
  }

  // After the send, so the row carries its outcome. The note body is NOT logged: it is
  // partner-written free text about a named restaurant (§5.8, no PII in logs/meta).
  await audit(partner.id, "client.change_requested", "Client", id, { emailed });

  revalidatePath(`/dashboard/clients/${id}`);
  return { ok: true };
}
