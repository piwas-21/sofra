// Direct SQL for the E2E suite, for the invariants a browser cannot see.
//
// The specs assert user-visible behaviour through the UI wherever the UI shows
// it. Some of what O2 must guarantee is deliberately NOT user-visible — that the
// new account has a null `passwordHash`, that exactly one plan exists, that a
// subscription reached ACTIVE rather than merely looking active — and asserting
// those through the UI would mean trusting the same rendering path the test is
// supposed to be checking. So this reads the database directly.
//
// `pg` (already a dependency, used by scripts/seed-e2e.mjs) rather than Prisma:
// the generated client is a server-runtime singleton wired to the app's adapter,
// and instantiating a second one inside the test process to read four columns
// buys nothing.
//
// Test-support only. Nothing here is imported by application code.

import pg from "pg";

/** One short-lived connection per call — the suite makes a handful of queries. */
async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the E2E suite");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<T>(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

export type OwnerRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  hasPassword: boolean;
};

export async function findUser(email: string): Promise<OwnerRow | null> {
  const rows = await query<{
    id: string;
    email: string;
    role: string;
    status: string;
    has_password: boolean;
  }>(
    `SELECT id, email, role, status, ("passwordHash" IS NOT NULL) AS has_password
       FROM "User" WHERE email = $1`,
    [email.toLowerCase()],
  );
  const r = rows[0];
  return r
    ? { id: r.id, email: r.email, role: r.role, status: r.status, hasPassword: r.has_password }
    : null;
}

export type PlanRow = {
  billingId: string;
  tenantSlug: string;
  email: string;
  hasPayer: boolean;
  hasClient: boolean;
  hasMollieCustomer: boolean;
  mollieCustomerId: string | null;
  amountCents: number | null;
  currency: string | null;
  interval: string | null;
  subStatus: string | null;
  mollieSubscriptionId: string | null;
};

/** The plan for a slug, joined to its newest subscription. */
export async function findPlan(tenantSlug: string): Promise<PlanRow | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT b.id                                   AS billing_id,
            b."tenantSlug"                         AS tenant_slug,
            b.email                                AS email,
            (b."payerUserId" IS NOT NULL)          AS has_payer,
            (b."clientId" IS NOT NULL)             AS has_client,
            (b."mollieCustomerId" IS NOT NULL)     AS has_mollie_customer,
            b."mollieCustomerId"                   AS mollie_customer_id,
            s."amountCents"                        AS amount_cents,
            s.currency                             AS currency,
            s.interval                             AS interval,
            s.status                               AS sub_status,
            s."mollieSubscriptionId"               AS mollie_subscription_id
       FROM "TenantBilling" b
       LEFT JOIN "BillingSubscription" s ON s."billingId" = b.id
      WHERE b."tenantSlug" = $1
      ORDER BY s."createdAt" DESC NULLS LAST
      LIMIT 1`,
    [tenantSlug],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    billingId: String(r.billing_id),
    tenantSlug: String(r.tenant_slug),
    email: String(r.email),
    hasPayer: Boolean(r.has_payer),
    hasClient: Boolean(r.has_client),
    hasMollieCustomer: Boolean(r.has_mollie_customer),
    mollieCustomerId: r.mollie_customer_id === null ? null : String(r.mollie_customer_id),
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    currency: r.currency === null ? null : String(r.currency),
    interval: r.interval === null ? null : String(r.interval),
    subStatus: r.sub_status === null ? null : String(r.sub_status),
    mollieSubscriptionId:
      r.mollie_subscription_id === null ? null : String(r.mollie_subscription_id),
  };
}

export async function countPlansFor(email: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM "TenantBilling" WHERE lower(email) = lower($1)`,
    [email],
  );
  return Number(rows[0].n);
}

export async function countSignups(email: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM "SignupRequest" WHERE lower(email) = lower($1)`,
    [email],
  );
  return Number(rows[0].n);
}

export async function countInviteTokens(userId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM "InviteToken"
      WHERE "userId" = $1 AND purpose = 'invite' AND "usedAt" IS NULL AND "expiresAt" > now()`,
    [userId],
  );
  return Number(rows[0].n);
}

/**
 * Put a plan into the mandate-lag window: a `paid` first payment while its
 * subscription is still PENDING.
 *
 * This ARRANGES a state, it does not fake a behaviour. That window is a database
 * state — `recordPayment` upserts the payment row *before* calling
 * `activatePendingSubscriptions`, so a real 503 from a not-yet-valid mandate
 * leaves exactly these rows. Writing them directly makes the window reachable on
 * demand instead of only when Mollie's sandbox happens to lag, and every line of
 * code the assertion then exercises (planState, the dashboard, the pay-button
 * suppression) runs for real against it. `planState` reads exactly two things —
 * `sub.status` and "is there a paid first payment" — and both are genuine here.
 *
 * Two harmless divergences from a real 503, neither of which `planState` reads:
 * the real path also has a non-null `mollieCustomerId`, and it UPDATES the
 * pre-existing open payment row (nulling `checkoutUrl`) instead of inserting one.
 */
export async function arrangeMandateLag(tenantSlug: string): Promise<void> {
  // INSERT…SELECT silently writes zero rows for an unknown slug. The caller would
  // then fail on a visibility assertion, sending the reader to look at the
  // dashboard instead of at the arrangement — so fail here, where the cause is.
  const inserted = await query<{ id: string }>(
    `INSERT INTO "BillingPayment"
       (id, "billingId", "molliePaymentId", "amountCents", currency, description,
        status, "sequenceType", method, "paidAt", "createdAt", "updatedAt")
     SELECT gen_random_uuid()::text, b.id, 'tr_e2e_' || substr(md5(random()::text), 1, 16),
            COALESCE(s."amountCents", 0), 'EUR', 'E2E arranged first payment',
            'paid', 'first', 'ideal', now(), now(), now()
       FROM "TenantBilling" b
       LEFT JOIN "BillingSubscription" s ON s."billingId" = b.id
      WHERE b."tenantSlug" = $1
      LIMIT 1
     RETURNING id`,
    [tenantSlug],
  );
  if (inserted.length !== 1) {
    throw new Error(`arrangeMandateLag: no billing row for slug "${tenantSlug}"`);
  }
}

/** The newest `first` payment for a slug: what the double-charge guard reads. */
export async function findFirstPayment(
  tenantSlug: string,
): Promise<{ molliePaymentId: string; status: string; checkoutUrl: string | null } | null> {
  const rows = await query<{
    mollie_payment_id: string;
    status: string;
    checkout_url: string | null;
  }>(
    `SELECT p."molliePaymentId" AS mollie_payment_id, p.status, p."checkoutUrl" AS checkout_url
       FROM "BillingPayment" p
       JOIN "TenantBilling" b ON b.id = p."billingId"
      WHERE b."tenantSlug" = $1 AND p."sequenceType" = 'first'
      ORDER BY p."createdAt" DESC
      LIMIT 1`,
    [tenantSlug],
  );
  const r = rows[0];
  return r
    ? { molliePaymentId: r.mollie_payment_id, status: r.status, checkoutUrl: r.checkout_url }
    : null;
}
