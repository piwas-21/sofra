import { getTranslations } from "next-intl/server";
import { shortDate } from "@/lib/format";
import { addMonthsClampedUtc, MAX_TRIAL_MONTHS_AHEAD, trialView } from "@/lib/trial";
import TrialExtendForm from "./TrialExtendForm";

/**
 * The free period on one plan, and the founder's control over it (T-c).
 *
 * Admin-only by placement AND by guard: it renders on `/admin/billing/[id]`, which
 * calls `requireAdmin()`, and the action behind the form calls it again. A partner
 * extending their own trial would be a partner granting themselves free product, so
 * this component has no partner-facing counterpart at all.
 *
 * It states the trial in the terms a decision needs — until when, and how much of it
 * is left — rather than printing a raw date. "Free until 19 September" is a fact;
 * "3 days left" is the one that gets a conversation started before a restaurant is
 * surprised by an invoice.
 */
export default async function TrialPanel({
  locale,
  billingId,
  trialEndsAt,
}: {
  readonly locale: string;
  readonly billingId: string;
  readonly trialEndsAt: Date | null;
}) {
  const t = await getTranslations({ locale, namespace: "control.admin.trial" });
  const now = new Date();
  const view = trialView(trialEndsAt, now);

  // The date input's own bounds, so the obvious mistakes are refused before a
  // round-trip. The server re-decides both (`extendTrialVerdict`) — this is
  // friction, not the guard: `min`/`max` are trivially removable in a browser.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const floor = view.kind === "active" && view.endsAt > now ? view.endsAt : now;
  const min = iso(new Date(floor.getTime() + 24 * 60 * 60 * 1000));
  const max = iso(addMonthsClampedUtc(now, MAX_TRIAL_MONTHS_AHEAD));

  const status = () => {
    if (view.kind === "active") {
      return t("active", { date: shortDate(view.endsAt), days: String(view.daysLeft) });
    }
    if (view.kind === "expired") return t("expired", { date: shortDate(view.endsAt) });
    return t("none");
  };

  return (
    <section className="hand-drawn-border bg-card p-5">
      <h2 className="font-hand text-2xl font-bold">{t("title")}</h2>
      <p className="mt-1 font-label text-sm text-muted-foreground">{status()}</p>
      <p className="mt-1 font-label text-sm text-muted-foreground">{t("intro")}</p>
      <div className="mt-3">
        <TrialExtendForm billingId={billingId} min={min} max={max} />
      </div>
    </section>
  );
}
