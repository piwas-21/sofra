import { db } from "@/lib/db";
import { openCommissionChangePr } from "@/lib/registry-commission-pr";
import { ProvisioningApiError, ProvisioningNotConfiguredError } from "@/lib/provisioning";

// The two halves of a payments-mode change, lifted out of the server action so the
// action reads as the sequence it is (propose, then record) rather than as two
// nested error funnels — and so `provisioning-actions.ts` stays under the §4 limit.

type CommissionProposal =
  | { ok: true; prUrl: string | null }
  | { ok: false; error: string };

/**
 * Open the registry PR, mapping every failure onto an action-state error.
 * `prUrl` is null when the registry already carried this rate — there is nothing
 * to propose, so no empty PR is opened, and the caller still records the intent.
 */
export async function proposeCommissionChange(
  tenantSlug: string,
  commissionBps: number,
): Promise<CommissionProposal> {
  try {
    const outcome = await openCommissionChangePr(tenantSlug, commissionBps);
    return { ok: true, prUrl: outcome.alreadySet ? null : outcome.prUrl };
  } catch (e) {
    if (e instanceof ProvisioningNotConfiguredError) {
      return { ok: false, error: "provisioningNotConfigured" };
    }
    if (e instanceof ProvisioningApiError) return { ok: false, error: e.message };
    console.error("updatePaymentsModeAction: openCommissionChangePr failed", e);
    return { ok: false, error: "paymentsModeChangeFailed" };
  }
}

/**
 * Record what we asked for, AFTER the proposal exists.
 *
 * THROWS rather than returning an error state, deliberately. By this point the PR
 * is open (or the rate already matched), so the failure leaves an orphan PR — not
 * an orphan CHARGE — and a swallowed action-state error would lose the PR URL,
 * which is the one thing a human needs to reconcile this by hand.
 */
export async function recordPaymentsModeIntent(args: {
  tenantSlug: string;
  mode: string;
  commissionBps: number;
  prUrl: string | null;
}): Promise<void> {
  const { tenantSlug, mode, commissionBps, prUrl } = args;
  try {
    await db.tenantBilling.update({
      where: { tenantSlug },
      data: { paymentsMode: mode, paymentsCommissionBps: commissionBps },
    });
  } catch (e) {
    const where = prUrl ? ` (${prUrl})` : " (rate already matched, no PR opened)";
    throw new Error(
      `payments mode change for '${tenantSlug}' was proposed${where} but recording ` +
        `the intent failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
