import { getTranslations } from "next-intl/server";
import { eur, shortDate } from "@/lib/format";

/**
 * A plan's payment history on the founder's billing detail page.
 *
 * Mollie's own vocabulary, verbatim and untranslated (`paid`, `first`, `ideal`) —
 * unlike the payer-facing lists, which collapse it through `paymentStatusKey`. This
 * one is read next to the Mollie dashboard while reconciling, and a friendlier word
 * here would mean the two screens no longer say the same thing about one payment.
 */
export default async function PlanPaymentsList({
  locale,
  payments,
}: {
  readonly locale: string;
  readonly payments: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly sequenceType: string;
    readonly method: string | null;
    readonly amountCents: number;
    readonly status: string;
    readonly paidAt: Date | null;
    readonly createdAt: Date;
  }>;
}) {
  const t = await getTranslations({ locale, namespace: "control.admin.billingDetail" });

  return (
    <section>
      <h2 className="font-hand text-3xl font-bold">{t("payments")}</h2>
      <ul className="mt-4 grid gap-2">
        {payments.map((p) => (
          <li
            key={p.id}
            className="hand-drawn-border bg-card p-3 font-label text-sm flex flex-wrap justify-between gap-2"
          >
            <span>
              {p.description} · {p.sequenceType}
              {p.method ? ` · ${p.method}` : ""}
            </span>
            <span>
              {eur(p.amountCents)} · <span className="font-bold">{p.status}</span> ·{" "}
              {shortDate(p.paidAt ?? p.createdAt)}
            </span>
          </li>
        ))}
        {payments.length === 0 && (
          <li className="font-label text-muted-foreground">{t("noPayments")}</li>
        )}
      </ul>
    </section>
  );
}
