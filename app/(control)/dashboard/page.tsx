import { requirePartnerOrOwner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import OwnerDashboard from "@/components/control/OwnerDashboard";
import PartnerDashboard from "@/components/control/PartnerDashboard";

// Both views read the tenant registry, which changes underneath us (rsync on
// deploy-repo push) — never serve a build-time snapshot of it. Same reason as
// /admin/tenants.
export const dynamic = "force-dynamic";

/**
 * `/dashboard` — shared by the reseller (PARTNER) and the restaurant owner (OWNER),
 * who want almost nothing in common.
 *
 * A partner reads a pipeline: many clients, each a row, the plans needing attention
 * pulled to the top. An owner has exactly one plan and one question — *where is my
 * restaurant app and how do I get into it?* Until O4 they shared one render, and the
 * owner's half of it was a single sentence ("nothing to do here right now") with no
 * amount, no next-charge date and no mention of their app at all.
 *
 * The two views are now separate components; this page owns only the guard, the
 * locale, and the one query both need.
 */
export default async function DashboardPage() {
  const user = await requirePartnerOrOwner();
  const isOwner = user.role === "OWNER";
  const locale = await controlLocale();

  // Billings scoped to the caller: an OWNER pays via payerUserId (ADR-004); a
  // PARTNER via their CRM clients.
  const billings = await db.tenantBilling.findMany({
    where: isOwner ? { payerUserId: user.id } : { client: { partnerId: user.id } },
    include: {
      client: true,
      // Needed to resolve whether this plan can be invoiced yet — the same
      // question `startPaymentAction` gates on, so the dashboard can offer the
      // details form instead of a pay button that would only error.
      billingIdentity: true,
      subscriptions: { orderBy: { createdAt: "desc" } },
      // Only first payments distinguish "pay" from "processing" (planState); scope +
      // bound so the unboundedly-growing recurring history is never pulled into this
      // request path. KEEP THIS SCOPED now that an owner also sees a history list:
      // widening it to "the 10 newest payments" would push the `first` payment out of
      // the window once a plan has ten recurring charges, and planState would then
      // read a paid, activating plan as "pay" — a pay button shown to somebody who
      // already paid. OwnerDashboard fetches the history separately, and bounds it
      // separately, for exactly that reason.
      payments: { where: { sequenceType: "first" }, orderBy: { createdAt: "desc" }, take: 20 },
      // What this plan BOUGHT (O7 P4). The registry says what was granted; only the
      // lead says what was paid for, and the gap between them is the window where a
      // buyer of online payments is charged for a module their tenant does not have
      // yet. One column, on a relation the row already carries.
      signupRequest: { select: { modules: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (isOwner) {
    return <OwnerDashboard locale={locale} ownerName={user.name} billings={billings} />;
  }

  const clients = await db.client.findMany({
    where: { partnerId: user.id },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <PartnerDashboard
      locale={locale}
      partnerName={user.name}
      billings={billings}
      clients={clients}
    />
  );
}
