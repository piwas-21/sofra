import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { BILLING_INTERVALS } from "@/lib/billing";
import CancelSubscriptionButton from "@/components/control/CancelSubscriptionButton";
import CopyField from "@/components/control/CopyField";

const intervalLabel = (mollie: string) =>
  Object.values(BILLING_INTERVALS).find((i) => i.mollie === mollie)?.label ?? mollie;

export default async function AdminBillingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const billing = await db.tenantBilling.findUnique({
    where: { id },
    include: {
      client: { include: { partner: true } },
      subscriptions: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!billing) notFound();

  const openCheckout = billing.payments.find(
    (p) => p.checkoutUrl && (p.status === "open" || p.status === "pending"),
  );

  return (
    <div className="grid gap-10">
      <div>
        <Link href="/admin/billing" className="font-label text-sm text-muted-foreground underline">
          ← All billing
        </Link>
        <h1 className="mt-3 font-display font-bold text-5xl">{billing.tenantSlug}</h1>
        <p className="mt-2 font-label text-muted-foreground">
          {billing.name} · {billing.email} · Mollie customer {billing.mollieCustomerId}
          {billing.client
            ? ` · CRM: ${billing.client.restaurantName} (partner ${billing.client.partner.name})`
            : ""}
        </p>
      </div>

      {openCheckout && (
        <section className="hand-drawn-border bg-card p-5">
          <h2 className="font-hand text-2xl font-bold">First-payment checkout link</h2>
          <p className="mt-1 font-label text-sm text-muted-foreground">
            Send this to the tenant — paying it creates the recurring mandate and auto-starts the
            plan.
          </p>
          <div className="mt-3">
            <CopyField value={openCheckout.checkoutUrl!} />
          </div>
        </section>
      )}

      <section>
        <h2 className="font-hand text-3xl font-bold">Subscriptions</h2>
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
                  {s.startDate ? ` · charges from ${shortDate(s.startDate)}` : ""}
                  {s.canceledAt ? ` · canceled ${shortDate(s.canceledAt)}` : ""}
                </span>
              </span>
              {(s.status === "ACTIVE" || s.status === "PENDING") && (
                <CancelSubscriptionButton id={s.id} />
              )}
            </li>
          ))}
          {billing.subscriptions.length === 0 && (
            <li className="font-label text-muted-foreground">No subscriptions.</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">Payments</h2>
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
            <li className="font-label text-muted-foreground">No payments yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
