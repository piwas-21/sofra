"use server";

// A partner PROPOSES where their client's restaurant should live
// (SOFRA-PARTNER-FLEXIBILITY-PLAN D2).
//
// Modelled on `requestClientChangeAction`, and it keeps the same boundary: this adds NO
// partner write to the registry, to modules or to the plan. The registry is edited in
// the deploy repo, in a PR, by the founder (ADR-003/007) — what a partner gets here is a
// durable ASK, recorded as a note on the client, mailed to the founder, and audited.
//
// The three things it will not do, in the order they are checked:
//   - propose for a client that is not theirs (`ownClient`, scoped by partnerId);
//   - propose for a tenant that already EXISTS (past that point the domain is an image
//     rebuild plus a re-provision, not a registry edit — a request, not a form);
//   - use a base domain that is not theirs and PROVEN (`ownBaseDomain` + `verifiedAt`,
//     both re-read server-side; the form's own value is never trusted).

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ownClient } from "@/lib/client-access";
import { ownBaseDomain } from "@/lib/partner-domain-access";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { sendEmail, founderInbox, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import {
  proposalNoteBody,
  resolveDomainProposal,
  type DomainProposal,
} from "@/lib/client-domain-choice";

/** `error` is a message key in `control.errors`; `proposal` is echoed back so the page
 *  can print the exact DNS record that now has to be published. */
export type DomainProposalState = {
  error?: string;
  ok?: boolean;
  proposal?: DomainProposal;
};

const readString = (formData: FormData, name: string): string => {
  // A FormData value can be a File, and `String(...)` on one yields "[object Object]" —
  // a lookup that would MISS rather than refuse (Sonar S6551).
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
};

export async function proposeClientDomainAction(
  _prev: DomainProposalState,
  formData: FormData,
): Promise<DomainProposalState> {
  const partner = await requirePartner();
  const client = await ownClient(partner.id, readString(formData, "id"));
  if (!client) return { error: "clientNotFound" };
  // Once a slug exists the tenant is founder-managed and its domain is baked into a
  // per-domain image. Offering a chooser there would be offering a one-click action for
  // something that is a rebuild + re-provision; that conversation is the change-request
  // form below it, not this.
  if (client.tenantSlug) return { error: "domainChoice.tenantExists" };

  if (!rateLimit(`client-domain:${partner.id}`, 10, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  // Re-read the base domain server-side, scoped by partnerId, and require the PROOF.
  // The form sends an id; believing it would make the whole of D1b decorative.
  let verifiedBaseDomain: string | undefined;
  const baseDomainId = readString(formData, "baseDomainId");
  if (baseDomainId) {
    const row = await ownBaseDomain(partner.id, baseDomainId);
    if (!row?.verifiedAt) return { error: "domainChoice.baseNotVerified" };
    verifiedBaseDomain = row.domain;
  }

  // The registry key is the SLUG whatever the domain is, so two tenants under different
  // zones still cannot share one. An unreadable registry fails open on `taken` (empty
  // list) exactly as `openProvisioningPrAction` does: the founder's own proposal is the
  // authority and will refuse it there.
  const registry = await loadTenantRegistry();
  const takenSlugs = registry.ok ? registry.tenants.map((t) => t.slug) : [];

  const resolved = resolveDomainProposal({
    choice: readString(formData, "choice"),
    slug: readString(formData, "slug"),
    verifiedBaseDomain,
    ownDomain: readString(formData, "ownDomain"),
    takenSlugs,
  });
  if (!resolved.ok) return { error: `domainChoice.${resolved.reason}` };
  const { proposal } = resolved;

  // The note FIRST, because it is the durable artefact — visible to the partner on the
  // page they typed it on and to the founder on /admin/clients, whether or not any mail
  // was delivered. Its body is the registry's OWN FIELD NAMES rather than a sentence:
  // an English sentence composed here would be an English sentence on a surface
  // translated six ways, and the founder can transcribe field names rather than
  // interpret prose. A partner's free-text note rides after it, verbatim.
  const message = readString(formData, "message").trim().slice(0, 2000);
  const body = message ? `${proposalNoteBody(proposal)}\n\n${message}` : proposalNoteBody(proposal);
  await db.clientNote.create({
    data: { clientId: client.id, authorId: partner.id, body },
  });

  const to = founderInbox();
  let emailed = false;
  if (to) {
    // Caught, like every send on an already-committed path: the note is written, and a
    // DNS/connect rejection escaping here would lose the audit row below.
    const notice = await sendEmail({
      to,
      subject: `SofraPiwas — Domain proposed: ${client.restaurantName}`,
      html: craftEmail({
        kicker: "Partner pipeline",
        title: "A partner proposed a domain",
        bodyHtml: detailRows([
          ["Restaurant", client.restaurantName],
          ["Domain", proposal.domain],
          ["Mode", proposal.domainMode],
          ["base_domain", proposal.baseDomain ?? "—"],
          [
            "DNS to publish first",
            proposal.requiredRecord
              ? `${proposal.requiredRecord.type} ${proposal.requiredRecord.name} → box (${proposal.publishedBy})`
              : "none — covered by the wildcard",
          ],
          ["Partner", `${partner.name} (${partner.email})`],
          ["Note", message || "—"],
        ]),
        cta: { label: "Open admin", url: `${siteUrl()}/admin/clients` },
        footerNote: "Registry changes stay founder-run (ADR-003/007) — this is a proposal.",
      }),
    }).catch(() => ({ sent: false }));
    emailed = notice.sent;
  }

  // After the send, so the row carries its outcome. The hostname is infrastructure, not
  // PII, and it is the whole content of the decision — the partner's free text is NOT
  // logged (§5.8).
  await audit(partner.id, "client.domain_proposed", "Client", client.id, {
    choice: proposal.choice,
    domain: proposal.domain,
    ...(proposal.baseDomain ? { baseDomain: proposal.baseDomain } : {}),
    emailed,
  });

  revalidatePath(`/dashboard/clients/${client.id}`);
  return { ok: true, proposal };
}
