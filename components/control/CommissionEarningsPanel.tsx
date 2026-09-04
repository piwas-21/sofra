import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { money, shortDate } from "@/lib/format";
import { commissionEarnings, type FeeMovement } from "@/lib/commission-earnings";

/**
 * What this tenant's commission actually earned, net of what was returned
 * (workspace docs/plans/BACKLOG.md, the second commission blocker).
 *
 * It lives on `/admin/billing/[id]` next to the payments-mode control on
 * purpose: "what rate is this tenant on" and "what did that rate collect"
 * belong side by side, and that adjacency is what makes a wrong rate visible.
 * NOT on `/admin/tenants` (that is the registry/enforcement view) and NOT on
 * `/dashboard/*` (partner-facing — this is Sofra's own revenue).
 *
 * A component rather than page code because the page is at its §4 limit, and a
 * server component because the only inputs are two indexed reads and a pure
 * function. Out of scope for this slice, deliberately: a roll-up across all
 * tenants, and any period control. The per-tenant number is what invoicing needs.
 */
export default async function CommissionEarningsPanel({
  locale,
  stripeAccount,
  registryReadable,
  now = new Date(),
}: {
  readonly locale: string;
  /** The registry entry's `stripe_account`, the only join key these tables have. */
  readonly stripeAccount: string | undefined;
  readonly registryReadable: boolean;
  /** Injected so the window is decidable in a test rather than raced. */
  readonly now?: Date;
}) {
  const t = await getTranslations({ locale, namespace: "control.admin.commissionEarnings" });

  // A fixed, server-computed window: the previous calendar month and the current
  // one, UTC (Stripe's own clock is UTC epoch seconds — mixing in a box-local
  // month boundary would move fees between periods depending on where the
  // container runs). Half-open: `>= from`, `< to`.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const account = stripeAccount?.trim();
  // The SQL window is an index-using pre-filter only; `commissionEarnings`
  // re-applies the same bounds and is the authority on the boundary rule. The
  // redundancy is deliberate — a wrong query can then only ever hand it a
  // superset, never a silently truncated set.
  const [earnedRows, refundedRows] = account
    ? await Promise.all([
        db.stripeApplicationFee.findMany({
          where: { connectedAccountId: account, feeCreatedAt: { gte: from, lt: to } },
          select: { amount: true, currency: true, feeCreatedAt: true, chargeId: true },
        }),
        db.stripeFeeRefund.findMany({
          where: { connectedAccountId: account, createdAt: { gte: from, lt: to } },
          select: {
            amount: true,
            currency: true,
            createdAt: true,
            feeRefundedAt: true,
            chargeId: true,
          },
        }),
      ])
    : [[], []];

  const earned: FeeMovement[] = earnedRows.map((r) => ({
    amount: r.amount,
    currency: r.currency,
    at: r.feeCreatedAt,
    chargeId: r.chargeId,
  }));
  const refunded: FeeMovement[] = refundedRows.map((r) => ({
    amount: r.amount,
    currency: r.currency,
    // Stripe's clock when we have it, ours when we do not — the rows the
    // fee-refund runbook created on staging predate the column and cannot be
    // backfilled.
    at: r.feeRefundedAt ?? r.createdAt,
    chargeId: r.chargeId,
  }));

  const result = commissionEarnings({ registryReadable, stripeAccount, earned, refunded, from, to });

  return (
    <section className="hand-drawn-border bg-card p-5">
      <h2 className="font-hand text-2xl font-bold">{t("title")}</h2>
      <p className="mt-1 font-label text-sm text-muted-foreground">{t("intro")}</p>
      {result.kind === "unavailable" ? (
        // No number at all, in EITHER reason — an unreadable registry is our
        // outage and must never be published as a claim about a tenant's money.
        <p className="mt-3 font-label text-sm text-muted-foreground">
          {result.reason === "registryUnavailable" ? t("registryUnavailable") : t("noAccount")}
        </p>
      ) : (
        <>
          <p className="mt-3 font-label text-sm text-muted-foreground">
            {t("period", { from: shortDate(from), to: shortDate(to) })}
          </p>
          {result.totals.length === 0 ? (
            // A DIFFERENT state from the two above, and it must read differently:
            // "we are watching this account and it collected nothing" is a fact.
            <p className="mt-2 font-label text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {result.totals.map((total) => (
                <li key={total.currency} className="font-label text-sm">
                  <span className="font-bold">
                    {t("net")}: {money(total.netMinor, total.currency)}
                  </span>
                  <span className="block text-muted-foreground">
                    {t("earned")}: {money(total.earnedMinor, total.currency)} ·{" "}
                    {t("refunded")}: {money(total.refundedMinor, total.currency)} ·{" "}
                    {t("fees", { count: total.feeCount })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result.unmatchedRefundCount > 0 && (
            // Explains a negative net instead of clamping it away. Real on day
            // one: staging holds refund rows whose fees predate this table.
            <p className="mt-2 font-label text-sm text-craft-warning-text dark:text-craft-warning">
              {t("unmatchedRefunds", { count: result.unmatchedRefundCount })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
