import type { RegistryTenant } from "@/lib/tenant-registry";
import { updatePaymentsModeAction } from "@/lib/actions/provisioning-actions";
import type { PaymentsMode } from "@/lib/payments-pricing";
import PaymentsModePanel from "./PaymentsModePanel";

/**
 * The OWNER's binding of the shared payments-mode panel
 * (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2b) — `/admin/billing/[id]`.
 *
 * The binding is what differs between the two surfaces, so it is what gets a file
 * of its own: which action the form posts to, which field names the tenant, and
 * which vocabulary the reader gets. The founder may name ANY tenant, so the field
 * is the slug itself and `requireAdmin()` in the action is the whole authorization
 * story. Its partner counterpart (`ClientPaymentsModePanel`) cannot do that, and
 * the two files sitting side by side is how that difference stays visible.
 */
export default function AdminPaymentsModePanel({
  locale,
  tenantSlug,
  billingMode,
  billingBps,
  registryTenant,
  registryReadable,
}: {
  readonly locale: string;
  readonly tenantSlug: string;
  readonly billingMode: PaymentsMode;
  readonly billingBps: number;
  readonly registryTenant: RegistryTenant | undefined;
  readonly registryReadable: boolean;
}) {
  return (
    <PaymentsModePanel
      locale={locale}
      namespace="control.admin.paymentsMode"
      target={{ field: "tenantSlug", value: tenantSlug }}
      submitAction={updatePaymentsModeAction}
      billingMode={billingMode}
      billingBps={billingBps}
      registryTenant={registryTenant}
      registryReadable={registryReadable}
    />
  );
}
