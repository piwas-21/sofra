// The scheduled half of the go-live announcement (EMAIL-SPEC-CONTROL-PLANE G1).
//
// WHY A SWEEP AND NOT AN EVENT. There is no completion event to hook: the control
// plane opens a registry PR, a GitHub workflow provisions on merge, and the box
// never calls back. `tenant-liveness.ts` already established that the only honest
// evidence a tenant is up is ASKING it, so the announcement is driven by the same
// probe, on a schedule, rather than by a status nobody writes.
//
// Ordering here is deliberate and is the difference between a cheap sweep and one
// that hammers every tenant box every run: already-announced tenants are filtered
// out from a single audit query BEFORE anything is probed.

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { probeTenantHealthy } from "@/lib/tenant-health";
import { tenantStage, tenantOrigin } from "@/lib/tenant-liveness";
import { goLiveDecision } from "@/lib/go-live-policy";
import { sendTenantLiveEmail } from "@/lib/go-live-email";

/** Audit action, and the once-ever marker the policy keys on. */
export const GO_LIVE_ACTION = "tenant.golive.announced";

/**
 * Tenants whose first payment settled before this instant are NEVER announced —
 * they went live under the old manual handover and an announcement now would be
 * nonsense at best. Measured before merge: without this, tenant 1 (RUMI) — paid,
 * registered and healthy — would have been mailed "your restaurant is live".
 *
 * Overridable so a staging run can announce its own fixtures, never to backdate:
 * an unparseable or absent value falls back to the safe constant.
 */
function announceFrom(): Date {
  const raw = process.env.GO_LIVE_ANNOUNCE_FROM;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date("2026-08-14T00:00:00Z");
}

export interface GoLiveSweepResult {
  /** Paid tenants that were not already announced. */
  considered: number;
  /** Owners mailed on this run. */
  announced: number;
  /** Why the rest were passed over -- counts only, no addresses. */
  skipped: Record<string, number>;
}

export async function runGoLiveSweep(): Promise<GoLiveSweepResult> {
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  // Only tenants that have actually settled a first payment can be live, and that
  // is also the population the funnel owes a message to.
  const candidates = await db.tenantBilling.findMany({
    where: { payments: { some: { status: "paid", sequenceType: "first" } } },
    select: {
      id: true,
      tenantSlug: true,
      name: true,
      email: true,
      provisioningPrUrl: true,
      // The settled first payment, for the no-retroactive-announcement cutoff.
      payments: {
        where: { status: "paid", sequenceType: "first" },
        orderBy: { paidAt: "asc" },
        take: 1,
        select: { paidAt: true },
      },
      // The human to greet, when there is one. `TenantBilling.name` is the
      // RESTAURANT, so using it for the salutation writes "Hi Chez Amara," to a
      // person. The direct-owner flow (ADR-004) sets payerUserId; the reseller
      // flow leaves it null and the restaurant name is then the honest fallback.
      payer: { select: { name: true } },
    },
  });
  if (candidates.length === 0) return { considered: 0, announced: 0, skipped };

  // One query for the whole population, rather than one per tenant per run.
  const announcedRows = await db.auditLog.findMany({
    where: {
      action: GO_LIVE_ACTION,
      entityType: "TenantBilling",
      entityId: { in: candidates.map((c) => c.id) },
    },
    select: { entityId: true },
  });
  const announced = new Set(announcedRows.map((r) => r.entityId));

  const cutoff = announceFrom();
  // Filter the pre-existing tenants out HERE, before any probing: it is both the
  // cheaper order and the one that cannot mail someone by accident.
  const pending = candidates.filter((c) => {
    if (announced.has(c.id)) return false;
    const paidAt = c.payments[0]?.paidAt ?? null;
    if (!paidAt || paidAt < cutoff) {
      skip("predatesFeature");
      return false;
    }
    return true;
  });
  if (pending.length === 0) return { considered: 0, announced: 0, skipped };

  // A registry that cannot be read is "no evidence" for every tenant -- the same
  // collapse `tenant-liveness.ts` documents -- never a reason to announce.
  const registry = await loadTenantRegistry();
  const domains = new Map<string, string>(
    registry.ok ? registry.tenants.map((t) => [t.slug, t.domain]) : [],
  );
  if (!registry.ok) {
    console.error("go-live sweep: registry unreadable —", registry.error);
  }

  let sentCount = 0;
  for (const c of pending) {
    const registryDomain = domains.get(c.tenantSlug) ?? null;
    // Probe ONLY when there is a domain to probe; a missing entry cannot be ready.
    const healthy = registryDomain ? await probeTenantHealthy(registryDomain) : false;
    const stage = tenantStage({
      paid: true,
      provisioningPrUrl: c.provisioningPrUrl,
      registryDomain,
      healthy,
    });

    const verdict = goLiveDecision({
      stage,
      firstPaidAt: c.payments[0]?.paidAt ?? null,
      announceFrom: cutoff,
      alreadyAnnounced: false, // filtered above; kept explicit for the reader
      to: c.email,
      origin: registryDomain ? tenantOrigin(registryDomain) : null,
    });

    if (!verdict.announce) {
      // "notReady" is the normal state of a tenant mid-provision and is counted,
      // not audited -- an audit row every few minutes per pending tenant would
      // bury the log in non-events.
      skip(verdict.reason);
      continue;
    }

    // Best-effort, like every other send on a committed path: a Resend outage must
    // not fail the sweep for the tenants after this one.
    const { sent } = await sendTenantLiveEmail({
      to: verdict.to,
      contactName: c.payer?.name ?? c.name,
      restaurantName: c.name,
      origin: verdict.origin,
    }).catch(() => ({ sent: false }));

    // Written even on failure: this row is the once-ever marker, and re-announcing
    // on every subsequent sweep is worse than one missed mail the founder can see
    // in the audit log (`sent: false`) and re-send by hand.
    await audit(null, GO_LIVE_ACTION, "TenantBilling", c.id, {
      tenantSlug: c.tenantSlug,
      sent,
    });
    if (sent) sentCount += 1;
    else skip("sendFailed");
  }

  return { considered: pending.length, announced: sentCount, skipped };
}
