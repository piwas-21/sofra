import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { BILLING_INTERVALS } from "@/lib/billing";
import CancelSubscriptionButton from "@/components/control/CancelSubscriptionButton";
import CopyField from "@/components/control/CopyField";
import BillingIdentityForm from "@/components/control/BillingIdentityForm";
import RecheckVatButton from "@/components/control/RecheckVatButton";
import { isInvoiceable } from "@/lib/billing-identity";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";
import { planDeletionVerdict, settledOrInFlight } from "@/lib/plan-deletion";
import DeletePlanForm from "@/components/control/DeletePlanForm";

// Mollie interval string → control.admin.intervals key (display only).
const intervalKey = (mollie: string) =>
  Object.entries(BILLING_INTERVALS).find(([, i]) => i.mollie === mollie)?.[0];

export default async function AdminBillingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });
  const intervalLabel = (mollie: string) => {
    const key = intervalKey(mollie);
    return key ? t(`intervals.${key}`) : mollie;
  };
  const { id } = await params;
  const billing = await db.tenantBilling.findUnique({
    where: { id },
    include: {
      client: { include: { partner: true } },
      subscriptions: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      billingIdentity: true,
    },
  });
  if (!billing) notFound();

  // Same resolver the write uses: a plan with a null link still shows the PARTY's
  // identity, so the form can never overwrite a record it did not display.
  const identity = await resolveIdentityForPlan(billing);

  // Invoices are found by SLUG — `Invoice` has no FK to TenantBilling, so nothing
  // in the database would stop a delete from orphaning one.
  const invoiceCount = await db.invoice.count({ where: { tenantSlug: billing.tenantSlug } });
  const deletion = planDeletionVerdict({
    invoiceCount,
    liveOrSettledPaymentCount: billing.payments.filter((p) => settledOrInFlight(p.status)).length,
    liveSubscriptionCount: billing.subscriptions.filter((s) =>
      ["PENDING", "ACTIVATING", "ACTIVE"].includes(s.status),
    ).length,
    hasMollieCustomer: Boolean(billing.mollieCustomerId),
  });

  const openCheckout = billing.payments.find(
    (p) => p.checkoutUrl && (p.status === "open" || p.status === "pending"),
  );

  return (
    <div className="grid gap-10">
      <div>
        <Link href="/admin/billing" className="font-label text-sm text-muted-foreground underline">
          {t("billingDetail.back")}
        </Link>
        <h1 className="mt-3 font-display font-bold text-5xl">{billing.tenantSlug}</h1>
        <p className="mt-2 font-label text-muted-foreground">
          {billing.name} · {billing.email} ·{" "}
          {t("billingDetail.customer", { id: billing.mollieCustomerId ?? "—" })}
          {billing.client
            ? ` · ${t("billingDetail.crm", {
                restaurant: billing.client.restaurantName,
                partner: billing.client.partner.name,
              })}`
            : ""}
        </p>
      </div>

      {openCheckout && (
        <section className="hand-drawn-border bg-card p-5">
          <h2 className="font-hand text-2xl font-bold">{t("billingDetail.checkoutTitle")}</h2>
          <p className="mt-1 font-label text-sm text-muted-foreground">
            {t("billingDetail.checkoutIntro")}
          </p>
          <div className="mt-3">
            <CopyField value={openCheckout.checkoutUrl!} />
          </div>
        </section>
      )}

      <section className="hand-drawn-border bg-card p-5">
        <h2 className="font-hand text-2xl font-bold">{t("identity.title")}</h2>
        {/* `isInvoiceable`, not mere existence: a row can be present and still be
            missing a field an invoice must carry, and "there is a record" is not
            the question the founder needs answered here. */}
        <p className="mt-1 font-label text-sm text-muted-foreground">
          {isInvoiceable(identity) ? t("identity.intro") : t("identity.introEmpty")}
        </p>
        <div className="mt-4">
          <BillingIdentityForm
            billingId={billing.id}
            defaults={identity ?? undefined}
          />
        </div>
        {/* Outside the form on purpose — its own POST, and nesting forms is
            invalid HTML. This is the only exit from an UNAVAILABLE check. */}
        {identity?.vatNumber && (
          <div className="mt-3">
            <RecheckVatButton identityId={identity.id} />
          </div>
        )}
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("billingDetail.subscriptions")}</h2>
        <ul className="mt-4 grid gap-3">
          {billing.subscriptions.map((s) => (
            <li
              key={s.id}
              className="hand-drawn-border bg-card p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <span>
                <span className="font-label font-bold block">{s.description}</span>
                <span className="font-label text-sm text-muted-foreground">
                  {eur(s.amountCents)} · {intervalLabel(s.interval)} · {s.status.toLowerCase()}
                  {s.startDate
                    ? ` · ${t("billingDetail.chargesFrom", { date: shortDate(s.startDate) })}`
                    : ""}
                  {s.canceledAt
                    ? ` · ${t("billingDetail.canceledOn", { date: shortDate(s.canceledAt) })}`
                    : ""}
                </span>
              </span>
              {(s.status === "ACTIVE" || s.status === "PENDING") && (
                <CancelSubscriptionButton id={s.id} />
              )}
            </li>
          ))}
          {billing.subscriptions.length === 0 && (
            <li className="font-label text-muted-foreground">
              {t("billingDetail.noSubscriptions")}
            </li>
          )}
        </ul>
      </section>

      <section className="hand-drawn-border bg-card p-5">
        <h2 className="font-hand text-2xl font-bold">{t("planDelete.title")}</h2>
        <p className="mt-1 font-label text-sm text-muted-foreground">{t("planDelete.intro")}</p>
        {deletion.deletable && deletion.warnings.includes("orphanMollieCustomer") && (
          <p className="mt-2 font-label text-sm text-muted-foreground">
            {t("planDelete.orphanMollieCustomer", { id: billing.mollieCustomerId ?? "" })}
          </p>
        )}
        <div className="mt-3">
          <DeletePlanForm
            billingId={billing.id}
            tenantSlug={billing.tenantSlug}
            blockedReason={deletion.deletable ? undefined : deletion.blocker}
          />
        </div>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("billingDetail.payments")}</h2>
        <ul className="mt-4 grid gap-2">
          {billing.payments.map((p) => (
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
          {billing.payments.length === 0 && (
            <li className="font-label text-muted-foreground">{t("billingDetail.noPayments")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
