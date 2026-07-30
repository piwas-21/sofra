// The database half of the O2 payment gate: read a slug's billing facts and run the
// pure policy (lib/provisioning-payment-gate.ts) over them.
//
// This lived inside `openProvisioningPrAction` while that action was its only caller,
// with a comment explaining that keeping it there left the policy unit-testable without
// a database. That reasoning still holds for the POLICY — which is why it stays in the
// pure module — but the query now has a second caller (the payment-triggered proposal,
// O3), and a second copy of "what counts as settled" is exactly the kind of drift that
// would let one path provision what the other refuses.
//
// It cannot live in the action file: that is `"use server"`, where every export must be
// an async server action.

import { db } from "@/lib/db";
import { provisionGate, type ProvisionGateVerdict } from "@/lib/provisioning-payment-gate";

/**
 * Only `first` payments are fetched: a settled first payment is what the gate asks
 * about, and the recurring history grows without bound.
 */
export async function slugProvisionVerdict(slug: string): Promise<ProvisionGateVerdict> {
  const billing = await db.tenantBilling.findUnique({
    where: { tenantSlug: slug },
    include: {
      subscriptions: { select: { status: true } },
      payments: { where: { sequenceType: "first" }, select: { status: true }, take: 20 },
    },
  });
  if (!billing) return provisionGate(null);
  return provisionGate({
    selfServe: billing.payerUserId !== null,
    firstPaymentSettled: billing.payments.some((p) => p.status === "paid"),
    subscriptionActive: billing.subscriptions.some((s) => s.status === "ACTIVE"),
  });
}
