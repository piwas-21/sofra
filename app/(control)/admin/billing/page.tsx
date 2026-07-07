import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { eur, shortDate } from "@/lib/format";
import { mollieConfigured } from "@/lib/mollie";
import { BILLING_INTERVALS } from "@/lib/billing";
import BillingCreateForm from "@/components/control/BillingCreateForm";

const intervalLabel = (mollie: string) =>
  Object.values(BILLING_INTERVALS).find((i) => i.mollie === mollie)?.label ?? mollie;

export default async function AdminBillingPage() {
  await requireAdmin();
  const billings = await db.tenantBilling.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">Billing</h1>
        <p className="mt-2 font-label text-muted-foreground">
          Sofra → tenant subscriptions via Mollie (ADR-011 Job A). Create a billing account, send
          the tenant the first-payment link; the subscription starts itself once the mandate lands.
        </p>
      </div>

      {!mollieConfigured() && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          MOLLIE_API_KEY is not set on this environment — creating billing accounts is disabled.
        </p>
      )}

      <section>
        <h2 className="font-hand text-3xl font-bold">New billing account</h2>
        <div className="mt-4 hand-drawn-border bg-card p-5">
          <BillingCreateForm disabled={!mollieConfigured()} />
        </div>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">Tenants ({billings.length})</h2>
        <ul className="mt-4 grid gap-4">
          {billings.map((b) => {
            const active = b.subscriptions.filter((s) => s.status === "ACTIVE");
            const pending = b.subscriptions.filter((s) => s.status === "PENDING");
            const last = b.payments[0];
            return (
              <li key={b.id} className="hand-drawn-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <Link
                      href={`/admin/billing/${b.id}`}
                      className="font-hand text-2xl font-bold underline"
                    >
                      {b.tenantSlug}
                    </Link>
                    <span className="font-label text-sm text-muted-foreground block">
                      {b.name} · {b.email} · since {shortDate(b.createdAt)}
                    </span>
                  </span>
                  <span className="font-label text-sm text-right">
                    {active.map((s) => (
                      <span key={s.id} className="block">
                        {eur(s.amountCents)} · {intervalLabel(s.interval)} · active
                      </span>
                    ))}
                    {pending.length > 0 && (
                      <span className="block text-muted-foreground">
                        {pending.length} plan(s) awaiting first payment
                      </span>
                    )}
                    {last && (
                      <span className="block text-muted-foreground">
                        last payment: {last.status} ({eur(last.amountCents)})
                      </span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
          {billings.length === 0 && (
            <li className="font-label text-muted-foreground">No billing accounts yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
