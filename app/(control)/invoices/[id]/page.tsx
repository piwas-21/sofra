import { notFound } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import InvoiceDocument from "@/components/control/InvoiceDocument";

/**
 * One invoice, for the party it was issued to (and for the founder).
 *
 * Authorization is the point of this file. An invoice carries a legal name, a
 * street address and a VAT number, so it is visible to exactly two parties:
 *
 *   • an ADMIN, who issued it;
 *   • the payer it is addressed to — resolved through the SAME two links the
 *     rest of billing uses (`payerUserId` for a direct owner, `client.partnerId`
 *     for a reseller), never through the invoice's own snapshot, which is a
 *     frozen copy and must not be load-bearing for access.
 *
 * Anything else is a 404 rather than a 403: an id that leaks whether an invoice
 * exists is a small enumeration oracle over other people's billing.
 */
export default async function InvoicePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const user = await requireUser();
  const { id } = await params;

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { id: "asc" } },
      billingIdentity: { select: { userId: true } },
    },
  });
  if (!invoice) notFound();

  // The plans this invoice's tenant is billed under, so ownership can be decided
  // from the live relations rather than from the snapshot.
  const plan = await db.tenantBilling.findUnique({
    where: { tenantSlug: invoice.tenantSlug },
    select: { payerUserId: true, client: { select: { partnerId: true } } },
  });

  const owns =
    user.role === "ADMIN" ||
    invoice.billingIdentity.userId === user.id ||
    plan?.payerUserId === user.id ||
    plan?.client?.partnerId === user.id;
  if (!owns) notFound();

  return (
    <div className="py-6">
      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
