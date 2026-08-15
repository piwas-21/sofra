import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { sellerIdentityGaps } from "@/lib/seller-identity";
import { notFlaggedByAction } from "@/lib/email-delivery";
import ReissueInvoiceButton from "@/components/control/ReissueInvoiceButton";

// Invoices are written by the webhook, so a build snapshot would be stale the
// moment a payment settles.
export const dynamic = "force-dynamic";

/**
 * Issued invoices, and — the part that earns this page — the charges that could
 * NOT be invoiced.
 *
 * A blocked invoice is silent by construction: issuing runs inside the Mollie
 * webhook and is forbidden from throwing there (a failure must not turn a
 * successful payment into a retry loop), so the only way anyone learns that a
 * settled payment produced no document is if something shows them. That is this
 * list. Without it the failure mode is a quarter passing before an accountant
 * asks where the invoices are.
 */
export default async function AdminInvoicesPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.invoices" });

  const gaps = sellerIdentityGaps();

  const [invoices, uninvoiced] = await Promise.all([
    db.invoice.findMany({ orderBy: { issuedAt: "desc" }, take: 100 }),
    // Settled charges with no invoice against them. NOT EXISTS rather than
    // loading every issued id and passing them as a NOT IN list — that list grows
    // without bound, and the query silently gets slower every month it works.
    // There is no Prisma relation between the two (the link is the unique
    // `molliePaymentId` string), so this is raw by necessity, not preference.
    db.$queryRaw<
      {
        id: string;
        molliePaymentId: string;
        description: string;
        amountCents: number;
        paidAt: Date | null;
        tenantSlug: string;
      }[]
    >`
      SELECT p."id", p."molliePaymentId", p."description", p."amountCents", p."paidAt", b."tenantSlug"
      FROM "BillingPayment" p
      JOIN "TenantBilling" b ON b."id" = p."billingId"
      WHERE p."status" = 'paid'
        AND NOT EXISTS (
          SELECT 1 FROM "Invoice" i WHERE i."molliePaymentId" = p."molliePaymentId"
        )
      ORDER BY p."paidAt" DESC NULLS LAST
      LIMIT 50
    `,
  ]);

  // G16. Issuing already records whether the invoice mail went out; nothing rendered it, so an
  // invoice that exists as a PDF nobody received looked identical to one the customer has. A
  // missing flag is "nothing recorded" — invoices issued before the flag existed — not "delivered".
  const notDelivered = await notFlaggedByAction(
    "billing.invoice.issued",
    invoices.map((i) => i.id),
  );

  // The other half of G16's invoice story: a charge that could not be invoiced at all also tries to
  // tell the customer why, and `invoice-blocked.ts` records whether that told them. Same query,
  // different flag — which is why the flag is a parameter.
  const notNotified = await notFlaggedByAction(
    "billing.invoice.blocked",
    uninvoiced.map((p) => p.molliePaymentId),
    "customerNotified",
  );

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
      </div>

      {gaps.length > 0 && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("sellerMissing", { gaps: gaps.join(", ") })}
        </p>
      )}

      {uninvoiced.length > 0 && (
        <section>
          <h2 className="font-hand text-3xl font-bold">{t("blockedTitle")}</h2>
          <p className="mt-1 font-label text-sm text-muted-foreground">{t("blockedIntro")}</p>
          <ul className="mt-4 grid gap-2">
            {uninvoiced.map((p) => (
              <li
                key={p.id}
                className="hand-drawn-border bg-card p-3 font-label text-sm flex flex-wrap justify-between gap-2"
              >
                <span>
                  {p.tenantSlug} · {p.description}
                </span>
                <span className="flex items-center gap-3">
                  {eur(p.amountCents)} · {p.paidAt ? shortDate(p.paidAt) : "—"}
                  {notNotified.has(p.molliePaymentId) && (
                    <span className="font-mono text-craft-error-text">{t("notNotified")}</span>
                  )}
                  <ReissueInvoiceButton molliePaymentId={p.molliePaymentId} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("issuedTitle")}</h2>
        <ul className="mt-4 grid gap-2">
          {invoices.map((i) => (
            <li
              key={i.id}
              className="hand-drawn-border bg-card p-3 font-label text-sm flex flex-wrap justify-between gap-2"
            >
              <Link href={`/invoices/${i.id}`} className="underline font-mono">
                {i.number}
              </Link>
              <span>
                {i.tenantSlug} · {eur(i.grossCents)} · {i.taxTreatment} · {shortDate(i.issuedAt)}
                {notDelivered.has(i.id) && (
                  <span className="ml-2 font-mono text-craft-error-text">{t("notEmailed")}</span>
                )}
              </span>
            </li>
          ))}
          {invoices.length === 0 && (
            <li className="font-label text-muted-foreground">{t("empty")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
