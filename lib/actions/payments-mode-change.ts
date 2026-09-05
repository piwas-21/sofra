import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { openCommissionChangePr } from "@/lib/registry-commission-pr";
import { ProvisioningApiError, ProvisioningNotConfiguredError } from "@/lib/provisioning";
import type { PaymentsMode } from "@/lib/payments-pricing";

// A payments-mode change, in the three pieces every surface that offers one shares:
// propose (registry PR), record (Prisma intent), and the sequence that runs them in
// that order and audits the result. Lifted out of the server actions so each action
// reads as what it uniquely is — an AUTHORIZATION decision plus a form parse — rather
// than as two nested error funnels, and so `provisioning-actions.ts` stays under the
// §4 limit.
//
// Deliberately NOT a "use server" module: exporting `applyPaymentsModeChange` from one
// would publish "change any tenant's money configuration" as a callable endpoint whose
// first argument is the actor id. Same reason `lib/client-access.ts` is not one.

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

/** `error` is a message key in `control.errors` (rendered by <ActionError />);
 *  GitHub API errors pass through raw. `prUrl` when a PR was opened;
 *  `alreadySet` when the registry already carried the requested rate and no PR
 *  was needed. Declared here rather than beside either action: BOTH surfaces
 *  (owner `/admin`, partner `/dashboard`) return exactly this shape, and one
 *  form component renders it for both. */
export type PaymentsModeActionState = {
  error?: string;
  ok?: boolean;
  prUrl?: string;
  alreadySet?: boolean;
};

/**
 * How a payments-mode form names the tenant it is about — the hidden field it
 * posts, and the value in it.
 *
 * Two shapes because the difference IS the authorization boundary (S4): the owner
 * posts a `tenantSlug` and may name any tenant; a partner posts a `clientId` and
 * the server reads the slug off the row it loaded scoped by `partnerId`. Modelled
 * as a union rather than a free `name`/`value` pair so a third, invented field
 * name cannot be rendered by mistake.
 */
export type PaymentsModeTarget =
  | { field: "tenantSlug"; value: string }
  | { field: "clientId"; value: string };

/**
 * Who asked for the change (S4).
 *
 * Recorded on the audit row as its own FIELD rather than inferred at read time
 * from the actor's role: a user's role can change after the fact, and the
 * question the row has to answer years later is "who decided this", not "what is
 * that account today". The actor id is the human either way — a partner-initiated
 * change is audited against the PARTNER, never against the founder.
 */
export type PaymentsModeInitiator = "owner" | "partner";

export interface PaymentsModeChangeOutcome {
  state: PaymentsModeActionState;
  /** `TenantBilling.id` — the admin surface's own route parameter, returned so a
   *  caller can revalidate its page without a second query. Null when nothing was
   *  changed (no billing row, or the request was a no-op). */
  billingId: string | null;
}

/**
 * The whole change, once the CALLER has established that its actor may make it:
 * find the plan, refuse a no-op, open the registry PR, record the intent, audit.
 *
 * ONE function for both surfaces on purpose (S4). The owner's `/admin` action and
 * the partner's `/dashboard` action differ only in how they arrive at a
 * `tenantSlug` they are allowed to touch — everything after that point is the same
 * sequence, and two copies of it would be two things to keep in step, one of which
 * would eventually stop opening the PR before writing Prisma.
 *
 * It is NOT an authorization boundary and cannot be one: it is handed a slug and
 * cannot tell whose it is. Callers guard first (`requireAdmin()`, or
 * `requirePartner()` + `ownClient()` and the slug read OFF that row) — the same
 * split, and for the same reason, as `lib/client-tenant.ts`.
 */
export async function applyPaymentsModeChange(args: {
  actorId: string;
  initiator: PaymentsModeInitiator;
  tenantSlug: string;
  mode: PaymentsMode;
  commissionBps: number;
  /** Extra audit context, e.g. the `clientId` a partner acted through. */
  meta?: Record<string, unknown>;
}): Promise<PaymentsModeChangeOutcome> {
  const { actorId, initiator, tenantSlug, mode, commissionBps } = args;

  const billing = await db.tenantBilling.findUnique({ where: { tenantSlug } });
  if (!billing) return { state: { error: "billingNotFound" }, billingId: null };
  if (billing.paymentsMode === mode && billing.paymentsCommissionBps === commissionBps) {
    return { state: { error: "paymentsModeUnchanged" }, billingId: null };
  }
  const { paymentsMode: oldMode, paymentsCommissionBps: oldBps } = billing;

  // ORDER MATTERS, and is commented because it is easy to get backwards: open
  // the registry PR FIRST, write the Prisma intent SECOND. The PR is the
  // proposal that reaches a human; `TenantBilling` is our own record of what
  // we asked for. Writing Prisma first and having the PR call fail afterwards
  // would record an intent we never actually proposed to anyone. This order's
  // failure mode is the recoverable one instead — an open PR the intent
  // doesn't point at yet — never the other way round.
  const proposal = await proposeCommissionChange(tenantSlug, commissionBps);
  if (!proposal.ok) return { state: { error: proposal.error }, billingId: billing.id };
  const { prUrl } = proposal;

  await recordPaymentsModeIntent({ tenantSlug, mode, commissionBps, prUrl });

  await audit(actorId, "tenant.paymentsMode.changed", "TenantBilling", billing.id, {
    tenantSlug,
    initiator,
    oldMode,
    oldBps,
    newMode: mode,
    newBps: commissionBps,
    prUrl,
    ...args.meta,
  });

  // prUrl is null exactly when the registry already carried this rate, so no PR was opened.
  return {
    state: prUrl ? { ok: true, prUrl } : { ok: true, alreadySet: true },
    billingId: billing.id,
  };
}
