// Partner-facing billing display helpers (pure — no DB/Mollie). Shared by the
// dashboard welcome hero and the billing page so both read a plan the same way.
import { BILLING_INTERVALS } from "@/lib/billing";

/** Mollie interval grammar ("1 month") → control.plan.interval.* key. */
export const intervalKeyOf = (mollie: string) =>
  Object.entries(BILLING_INTERVALS).find(([, i]) => i.mollie === mollie)?.[0] ?? "month";

type SubLike = { status: string } | undefined;
type PayLike = { sequenceType: string; status: string };

/**
 * What the partner should see for a plan:
 *   pay        — PENDING, no first payment paid yet → show the pay button
 *   processing — first payment paid but not yet ACTIVE (mandate-lag window) or
 *                mid-activation → show "processing", NEVER a second pay button
 *                (that window is the double-charge trap)
 *   active / inactive / none
 */
export type PlanState = "pay" | "processing" | "active" | "inactive" | "none";

export function planState(sub: SubLike, payments: PayLike[]): PlanState {
  if (!sub) return "none";
  if (sub.status === "ACTIVE") return "active";
  const firstPaid = payments.some((p) => p.sequenceType === "first" && p.status === "paid");
  if (sub.status === "PENDING") return firstPaid ? "processing" : "pay";
  if (sub.status === "ACTIVATING") return "processing";
  return "inactive"; // CANCELED / SUSPENDED / COMPLETED
}
