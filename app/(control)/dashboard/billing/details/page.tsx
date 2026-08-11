import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePartnerOrOwner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { isInvoiceable } from "@/lib/billing-identity";
import BillingIdentityForm from "@/components/control/BillingIdentityForm";
import { savePayerIdentityAction } from "@/lib/actions/payer-identity-actions";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";

export const dynamic = "force-dynamic";

/**
 * The payer's own billing details (B5).
 *
 * Every plan they pay for, each with the identity its invoices are addressed to.
 * Scoped by the same two links the rest of billing uses — `payerUserId` for a
 * direct owner, `client.partnerId` for a reseller — so a payer sees their own
 * plans and no others.
 *
 * This exists because the founder should not be the only person who can correct
 * a customer's own address, and because the details are needed BEFORE the first
 * payment: `startPaymentAction` refuses to open a checkout without them, so that
 * a charge cannot settle with no way to invoice it.
 */
export default async function PayerBillingDetailsPage() {
  const user = await requirePartnerOrOwner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.identity" });
  const tp = await getTranslations({ locale, namespace: "control.plan" });

  const plans = await db.tenantBilling.findMany({
    where: {
      OR: [{ payerUserId: user.id }, { client: { partnerId: user.id } }],
    },
    include: { billingIdentity: true, client: { select: { partnerId: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Resolved exactly as the write resolves it. Reading `p.billingIdentity` here
  // would render eleven empty fields for a plan whose link is null while the save
  // updated the party's EXISTING record — see resolveIdentityForPlan.
  const resolved = await Promise.all(
    plans.map(async (p) => ({ plan: p, identity: await resolveIdentityForPlan(p) })),
  );

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("payerIntro")}</p>
        <Link
          href="/dashboard/billing"
          className="mt-2 inline-block font-label text-sm text-muted-foreground underline"
        >
          {t("backToPlan")}
        </Link>
      </div>

      {plans.length === 0 && <p className="font-hand text-2xl text-muted-foreground">{tp("empty")}</p>}

      {resolved.map(({ plan, identity }) => (
        <section key={plan.id} className="hand-drawn-border bg-card p-5">
          <h2 className="font-hand text-2xl font-bold">{plan.tenantSlug}</h2>
          <p className="mt-1 font-label text-sm text-muted-foreground">
            {isInvoiceable(identity) ? t("intro") : t("introEmpty")}
          </p>
          <div className="mt-4">
            <BillingIdentityForm
              billingId={plan.id}
              defaults={identity ?? undefined}
              saveAction={savePayerIdentityAction}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
