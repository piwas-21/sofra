import type { ClientTenantView } from "@/lib/client-tenant";
import { asPaymentsMode } from "@/lib/payments-pricing";
import { updateClientPaymentsModeAction } from "@/lib/actions/partner-payments-actions";
import PaymentsModePanel from "./PaymentsModePanel";

/** The plan fields this panel reads — `TenantBilling`, narrowed to two columns. */
interface BillingModeRow {
  readonly paymentsMode: string;
  readonly paymentsCommissionBps: number;
}

/**
 * The PARTNER's binding of the shared payments-mode panel
 * (SOFRA-PAYMENTS-PRICING-MODE-PLAN S4) — `/dashboard/clients/[id]`.
 *
 * The field it posts is the CLIENT ID, never the tenant slug: a slug is a global
 * name in the deploy repo's registry, and a form that carried one would be handing
 * a partner the identifier of somebody else's restaurant to submit.
 * `updateClientPaymentsModeAction` re-loads the client scoped by `partnerId` and
 * takes the slug off that row — this component's job is only to make sure a slug
 * is never in the browser's hands to begin with.
 *
 * Renders NOTHING unless the tenant is `live` in the registry and the client has a
 * plan. Both are fail-quiet refusals, not oversights: with no registry entry there
 * is nothing to amend and no eligibility to check (a rate without
 * `online-payments` + `stripe_account` is refused by `provision-tenant.sh` before
 * the database), and with no plan there is no billing intent for a mode to be a
 * property OF. The unreadable-registry case takes the same direction the rest of
 * this dashboard does — say nothing, rather than make a claim about a tenant's
 * money out of our own outage.
 */
export default function ClientPaymentsModePanel({
  locale,
  clientId,
  view,
  billing,
}: {
  readonly locale: string;
  readonly clientId: string;
  readonly view: ClientTenantView;
  readonly billing: BillingModeRow | null | undefined;
}) {
  if (view.kind !== "live" || !billing) return null;

  return (
    <PaymentsModePanel
      locale={locale}
      namespace="control.clientPaymentsMode"
      target={{ field: "clientId", value: clientId }}
      submitAction={updateClientPaymentsModeAction}
      billingMode={asPaymentsMode(billing.paymentsMode)}
      billingBps={billing.paymentsCommissionBps}
      registryTenant={view.tenant}
      registryReadable
    />
  );
}
