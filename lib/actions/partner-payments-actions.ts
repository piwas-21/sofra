"use server";

// The partner's payments-mode control for their OWN clients
// (SOFRA-PAYMENTS-PRICING-MODE-PLAN S4) — the same amendment the founder makes on
// /admin/billing/[id], reachable by the person who actually owns the commercial
// relationship, and reachable for nothing else.
//
// THE WHOLE RISK OF THIS FILE IS THE AUTHORIZATION BOUNDARY, so it is built to make
// the dangerous shape impossible rather than merely absent:
//
//   1. The form submits a CLIENT ID, never a tenant slug. A slug is a global name in
//      the deploy repo's registry — a partner who could post one would be posting the
//      identifier of somebody else's restaurant into a registry editor.
//   2. `requirePartner()` first, then `ownClient(partner.id, id)` — the one query
//      scoped by `partnerId`, shared with `partner-change-actions.ts`.
//   3. The `tenantSlug` handed onward is read OFF THAT ROW. There is no code path
//      here in which a partner-supplied string reaches `openCommissionChangePr`.
//
// Everything after that point is `applyPaymentsModeChange`, the same sequence the
// owner's action runs (registry PR first, Prisma intent second, then the audit row) —
// one implementation so the two surfaces cannot drift apart.
//
// This does NOT cross the ADR-003/007 boundary the change-request form respects. The
// registry is still only ever edited in the deploy repo, in a PR, merged by a human:
// what a partner gets here is the ability to PROPOSE that PR for a tenant they sold,
// not to write to a box.

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/rbac";
import { ownClient } from "@/lib/client-access";
import { provisioningConfigured } from "@/lib/provisioning";
import { paymentsModeChangeSchema } from "@/lib/validation";
import {
  applyPaymentsModeChange,
  type PaymentsModeActionState,
} from "./payments-mode-change";

/**
 * Set one of the calling partner's clients onto flat or commission pricing.
 *
 * Refuses, in order and before touching anything: a caller who is not a partner
 * (`requirePartner()` throws), a client that is not theirs (`clientNotFound` — the
 * SAME answer another partner's real client gets, so this cannot be used to learn
 * which restaurants exist), and a client with no tenant yet (`clientNotProvisioned`:
 * there is no registry entry to amend, and inventing a slug from the client's name
 * is exactly the mistake this action is shaped to prevent).
 */
export async function updateClientPaymentsModeAction(
  _prev: PaymentsModeActionState,
  formData: FormData,
): Promise<PaymentsModeActionState> {
  const partner = await requirePartner();
  if (!provisioningConfigured()) return { error: "provisioningNotConfigured" };

  // Read as a string rather than `String(...)`: a FormData value can be a File, and
  // stringifying one yields "[object Object]" — a lookup that would then miss rather
  // than refuse (Sonar S6551, same shape as `requestClientChangeAction`).
  const raw = formData.get("clientId");
  const clientId = typeof raw === "string" ? raw : "";
  const client = await ownClient(partner.id, clientId);
  if (!client) return { error: "clientNotFound" };
  if (!client.tenantSlug) return { error: "clientNotProvisioned" };

  const parsed = paymentsModeChangeSchema.safeParse({
    // FROM THE ROW. The form has no slug field at all, and if it grew one it would
    // be ignored here — which is the property this line exists to hold.
    tenantSlug: client.tenantSlug,
    mode: formData.get("mode"),
    commissionBps: formData.get("commissionBps"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };

  const outcome = await applyPaymentsModeChange({
    actorId: partner.id,
    initiator: "partner",
    tenantSlug: client.tenantSlug,
    mode: parsed.data.mode,
    commissionBps: parsed.data.commissionBps,
    // The client is the partner's own name for this tenant, and the join the audit
    // row would otherwise have to be reconstructed through by hand.
    meta: { clientId: client.id },
  });

  revalidatePath(`/dashboard/clients/${client.id}`);
  // The PR URL is withheld from this surface on purpose. It points into the PRIVATE
  // deploy repo, which a partner cannot open — a link that 404s is worse news than no
  // link — and the URL is not lost: it is on the audit row and in the plan's
  // `TenantBilling` record. The partner gets the acknowledgement, not our plumbing.
  return outcome.state.prUrl ? { ok: true } : outcome.state;
}
