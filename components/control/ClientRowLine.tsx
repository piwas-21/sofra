import { getTranslations } from "next-intl/server";
import { eur } from "@/lib/format";
import { intervalKeyOf, type PlanState } from "@/lib/billing-display";
import type { ClientRowSummary } from "@/lib/client-tenant";

/** `planState` → a short `control.tenant.row*` label. Total by construction, so a new
 *  plan state cannot silently render as nothing. */
const PLAN_STATE_KEY: Record<PlanState, string> = {
  pay: "rowPay",
  processing: "rowProcessing",
  active: "rowActive",
  inactive: "rowInactive",
  none: "rowNoPlan",
};

/** Short label used when the row has no domain to print: the tenant is being set up,
 *  or the registry could not tell us anything about it. Covers `live` too, because a
 *  hand-edited entry with a blank `domain:` must degrade to a label, not to nothing. */
const VIEW_KEY: Record<Exclude<ClientRowSummary["view"], "none">, string> = {
  awaiting: "rowAwaiting",
  unreadable: "rowUnknown",
  unlisted: "rowUnknown",
  live: "rowUnknown",
};

/**
 * The tenant + plan line under a client's name in the partner list.
 *
 * A reseller's list was name · city · "updated {date}" — true of a lead and of a live,
 * paying restaurant alike. This is the line that tells the two apart at a glance: where
 * it runs, and what it costs. Nothing here links anywhere; the row is already an anchor
 * to the client page, and a nested `<a>` is invalid HTML.
 */
export default async function ClientRowLine({
  locale,
  summary,
}: {
  readonly locale: string;
  readonly summary: ClientRowSummary | undefined;
}) {
  const t = await getTranslations({ locale, namespace: "control.tenant" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });
  // A client still in the pipeline has no tenant and no plan — the row stays as it was.
  if (!summary || summary.view === "none") return null;

  const plan = summary.plan;
  const parts: string[] = [summary.domain || t(VIEW_KEY[summary.view])];
  if (plan?.amountCents != null && plan.interval != null) {
    const interval = tp(`interval.${intervalKeyOf(plan.interval)}`);
    parts.push(`${eur(plan.amountCents)} / ${interval}`);
  }
  parts.push(t(PLAN_STATE_KEY[plan?.state ?? "none"]));

  return (
    <span className="font-label text-sm text-muted-foreground block">{parts.join(" · ")}</span>
  );
}
