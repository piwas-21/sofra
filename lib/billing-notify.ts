// Founder-facing notification for a payment (S9), split out of lib/billing.ts so the
// billing STATE MACHINE and the prose about it stay separate concerns. The split earned
// itself when O3 added the automatic-proposal outcome: billing.ts is a grandfathered
// over-limit file (scripts/file-length-baseline.txt), and email formatting is the part
// that had no business growing it.

import { sendEmail, founderInbox } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { eur } from "@/lib/format";
import { AUTO_PROPOSE_NOTES, type AutoProposeOutcome } from "@/lib/auto-provision-policy";
import type { MolliePayment } from "@/lib/mollie";

/** One row for the payment email. `detailRows` escapes both columns itself. */
function proposalLine(proposal: AutoProposeOutcome): string {
  switch (proposal.kind) {
    case "opened":
      return `registry PR opened automatically — ${proposal.prUrl}`;
    case "alreadyProposed":
      return `already proposed — ${proposal.prUrl}`;
    case "skipped":
      return AUTO_PROPOSE_NOTES[proposal.reason];
    case "failed":
      return `AUTOMATIC PROPOSAL FAILED — open it by hand at /admin/provision. Reason: ${proposal.detail}`;
  }
}

/** A failed auto-open is the one case where the footer has to ask for action. */
function proposalFooter(proposal: AutoProposeOutcome | null): string {
  if (proposal?.kind === "failed") {
    return "The payment is fine — the automatic registry proposal is not. Open it by hand; nothing else is owed.";
  }
  if (proposal?.kind === "opened") {
    return "Review and merge the registry PR to stand the tenant up. Merging provisions it.";
  }
  return "Mirrored into the control plane automatically.";
}

export async function notifyFounder(
  tenantSlug: string,
  payment: MolliePayment,
  amountCents: number,
  proposal: AutoProposeOutcome | null,
) {
  const interesting =
    payment.status === "paid" ||
    payment.status === "failed" ||
    payment.status === "expired" ||
    payment.status === "canceled";
  if (!interesting) return;
  const inbox = founderInbox();
  if (!inbox) return;
  const ok = payment.status === "paid";
  await sendEmail({
    to: inbox,
    subject: `[SofraPiwas billing] ${tenantSlug}: ${payment.sequenceType} payment ${payment.status} (${eur(amountCents)})`,
    html: craftEmail({
      kicker: "Billing",
      title: ok ? "Payment received" : `Payment ${payment.status}`,
      // detailRows escapes both columns itself.
      bodyHtml: detailRows([
        ["Tenant", tenantSlug],
        ["Amount", eur(amountCents)],
        ["Type", payment.sequenceType],
        ["Status", payment.status],
        ["Mollie id", payment.id],
        // The automatic proposal's outcome rides the email the founder already opens
        // for a payment, rather than a second message. It is the ONLY place a failed
        // auto-open surfaces: the webhook must answer 2xx, so it cannot signal there.
        ...(proposal ? [["Provisioning", proposalLine(proposal)] as [string, string]] : []),
      ]),
      footerNote: ok
        ? proposalFooter(proposal)
        : "Check the Mollie dashboard — a failed recurring charge may need dunning.",
    }),
  });
}

/**
 * A failed automatic proposal gets its OWN message rather than a line in the payment
 * email, because that email is sent after `activatePendingSubscriptions` — which
 * deliberately throws during the mandate race to force a webhook 503. A silently expired
 * PROVISION_GITHUB_TOKEN plus a lagging mandate would otherwise be reported nowhere.
 *
 * Never throws: `sendEmail` swallows a non-2xx into `{sent:false}`, but `fetch` itself
 * REJECTS on a DNS/connect failure, and letting that escape would turn a reporting
 * problem into a webhook 500 and a Mollie retry loop (the O2 lesson, one layer along).
 */
export async function reportFailedProposal(tenantSlug: string, detail: string): Promise<void> {
  try {
    const inbox = founderInbox();
    if (!inbox) return;
    await sendEmail({
      to: inbox,
      subject: `[SofraPiwas] ${tenantSlug}: automatic registry proposal FAILED`,
      html: craftEmail({
        kicker: "Provisioning",
        title: "Automatic proposal failed",
        bodyHtml: detailRows([
          ["Tenant", tenantSlug],
          ["Reason", detail],
        ]),
        footerNote:
          "The payment itself is fine. Open the registry PR by hand at /admin/provision — nothing else is owed.",
      }),
    });
  } catch (e) {
    console.error("reportFailedProposal: could not notify", tenantSlug, e);
  }
}
