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

import bcrypt from "bcryptjs";
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

/** The columns the plan query selects, named as Postgres returns them. Declared
 *  rather than read back through `Record<string, unknown>`: an `unknown` forced
 *  through `String()` silently renders `[object Object]` if a type ever changes,
 *  which in a test helper means an assertion comparing two pieces of nonsense. */
type PlanQueryRow = {
  billing_id: string;
  tenant_slug: string;
  email: string;
  has_payer: boolean;
  has_client: boolean;
  has_mollie_customer: boolean;
  mollie_customer_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  sub_status: string | null;
  mollie_subscription_id: string | null;
};

/** The plan for a slug, joined to its newest subscription. */
export async function findPlan(tenantSlug: string): Promise<PlanRow | null> {
  const rows = await query<PlanQueryRow>(
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
    billingId: r.billing_id,
    tenantSlug: r.tenant_slug,
    email: r.email,
    hasPayer: r.has_payer,
    hasClient: r.has_client,
    hasMollieCustomer: r.has_mollie_customer,
    mollieCustomerId: r.mollie_customer_id,
    amountCents: r.amount_cents,
    currency: r.currency,
    interval: r.interval,
    subStatus: r.sub_status,
    mollieSubscriptionId: r.mollie_subscription_id,
  };
}

/**
 * The invoice raised for a tenant's settled charge, if any.
 *
 * Exists so the billing spec can assert that a paid webhook actually produced a
 * DOCUMENT. Without it the whole issuance path — the advisory-lock allocator, the
 * MAX(seq) read, the JSON snapshot write — has no executed coverage anywhere,
 * because `issueInvoiceForPayment` short-circuits on an unconfigured seller long
 * before it opens a transaction, and the run still reports green.
 */
export async function findInvoice(
  tenantSlug: string,
): Promise<{ number: string; netCents: number; vatCents: number; grossCents: number; taxTreatment: string } | null> {
  const rows = await query<{
    number: string;
    net_cents: number;
    vat_cents: number;
    gross_cents: number;
    tax_treatment: string;
  }>(
    `SELECT number,
            "netCents"     AS net_cents,
            "vatCents"     AS vat_cents,
            "grossCents"   AS gross_cents,
            "taxTreatment" AS tax_treatment
       FROM "Invoice" WHERE "tenantSlug" = $1 ORDER BY seq DESC LIMIT 1`,
    [tenantSlug],
  );
  const r = rows[0];
  return r
    ? {
        number: r.number,
        netCents: r.net_cents,
        vatCents: r.vat_cents,
        grossCents: r.gross_cents,
        taxTreatment: r.tax_treatment,
      }
    : null;
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

/**
 * Put a plan into the steady state a paying customer lives in for years: an ACTIVE
 * subscription that has already taken its first recurring charge.
 *
 * Like `arrangeMandateLag`, this ARRANGES a state rather than faking a behaviour — and
 * getting that right matters more here than it looks. `startDate` is deliberately set
 * in the PAST, because that is the only thing production can produce once a recurring
 * charge exists: `subscriptionStartDate` writes it as activation + one interval and
 * nothing ever advances it, so a plan with a `recurring` payment necessarily has a
 * `startDate` behind it. An arrangement with a FUTURE `startDate` plus a recurring
 * charge is a state no code path can reach, and a "next charge on <date>" assertion
 * against it proves only that the helper's own date round-trips to the DOM — the whole
 * point is that the app must DERIVE the next charge rather than print that column.
 */
export async function arrangeActivePlan(
  tenantSlug: string,
  opts: { firstChargeIso: string },
): Promise<void> {
  const updated = await query<{ id: string }>(
    `UPDATE "BillingSubscription" s
        SET status = 'ACTIVE',
            "startDate" = $2::timestamptz,
            "mollieSubscriptionId" = 'sub_e2e_' || substr(md5(random()::text), 1, 16)
       FROM "TenantBilling" b
      WHERE s."billingId" = b.id AND b."tenantSlug" = $1
     RETURNING s.id`,
    [tenantSlug, opts.firstChargeIso],
  );
  if (updated.length !== 1) {
    throw new Error(`arrangeActivePlan: no subscription for slug "${tenantSlug}"`);
  }
  // A `first` payment (what planState reads) and a `recurring` one — which is what
  // makes `startDate` stale, and what makes the history list more than a single row.
  for (const [sequence, status] of [
    ["first", "paid"],
    ["recurring", "paid"],
  ]) {
    // Same reason arrangeMandateLag checks: INSERT…SELECT writes zero rows for an
    // unknown slug and the caller would then fail on a visibility assertion, sending
    // the reader to the dashboard instead of to the arrangement.
    const inserted = await query<{ id: string }>(
      `INSERT INTO "BillingPayment"
         (id, "billingId", "molliePaymentId", "amountCents", currency, description,
          status, "sequenceType", method, "paidAt", "createdAt", "updatedAt")
       SELECT gen_random_uuid()::text, b.id, 'tr_e2e_' || substr(md5(random()::text), 1, 16),
              COALESCE(s."amountCents", 0), 'EUR', 'E2E arranged payment',
              $2, $3, 'ideal', now(), now(), now()
         FROM "TenantBilling" b
         LEFT JOIN "BillingSubscription" s ON s."billingId" = b.id
        WHERE b."tenantSlug" = $1
        LIMIT 1
       RETURNING id`,
      [tenantSlug, status, sequence],
    );
    if (inserted.length !== 1) {
      throw new Error(`arrangeActivePlan: no billing row for slug "${tenantSlug}"`);
    }
  }
}

/**
 * Move a plan onto a slug the registry fixture knows about.
 *
 * The signup refuses a taken slug (correctly), so a self-serve plan can never START
 * life pointing at a registry entry — which is exactly the state the owner dashboard
 * has to handle once the founder merges the entry. Repointing the row afterwards is
 * the only way to reach it in a suite with no provisioning.
 *
 * `tenantSlug` is `@unique`, and the target is a fixed fixture slug, so a Playwright
 * RETRY would otherwise hit a 23505 from the row its own first attempt left behind —
 * a Postgres error masking whatever the original assertion failure was. Clearing the
 * target first makes the helper idempotent across attempts. Safe only because this is
 * a throwaway database whose rows exist for one test.
 */
export async function repointBillingSlug(fromSlug: string, toSlug: string): Promise<void> {
  await query(`DELETE FROM "TenantBilling" WHERE "tenantSlug" = $1`, [toSlug]);
  const rows = await query<{ id: string }>(
    `UPDATE "TenantBilling" SET "tenantSlug" = $2 WHERE "tenantSlug" = $1 RETURNING id`,
    [fromSlug, toSlug],
  );
  if (rows.length !== 1) throw new Error(`repointBillingSlug: no billing row for "${fromSlug}"`);
}

/** Record that a registry proposal was opened, without opening one. */
export async function arrangeProposalOpened(tenantSlug: string, url: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `UPDATE "TenantBilling" SET "provisioningPrUrl" = $2 WHERE "tenantSlug" = $1 RETURNING id`,
    [tenantSlug, url],
  );
  if (rows.length !== 1) throw new Error(`arrangeProposalOpened: no billing row for "${tenantSlug}"`);
}

/**
 * A user that exists, is ACTIVE and has a real bcrypt password hash — the KNOWN side of
 * the login-timing comparison (#145).
 *
 * Seeded per run rather than reusing `E2E_ADMIN_EMAIL` because `lib/auth.ts` also limits
 * `login:email:<address>` to 10 per 15 minutes, that bucket counts FAILURES, and no header
 * can isolate it (the per-test `x-forwarded-for` fixture only splits the IP dimension). The
 * timing spec spends seven attempts on its known address and the rest of the suite already
 * spends four of the admin's — doubling under CI's `retries: 1` — so sharing would
 * rate-limit the OTHER specs' logins, and a rate-limited login fails with the same generic
 * copy as a broken one.
 *
 * The password is never used to sign in successfully; what is measured is that verifying a
 * wrong one costs the same bcrypt compare as an address with no row at all.
 */
export async function arrangeUserWithPassword(email: string, password: string): Promise<void> {
  // Same cost factor as scripts/seed-e2e.mjs and lib/auth.ts: the whole measurement is the
  // cost of one compare, so a cheaper hash here would understate the known side.
  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await query<{ id: string }>(
    `INSERT INTO "User" (id, email, "passwordHash", name, role, status, "createdAt")
     VALUES (gen_random_uuid()::text, lower($1), $2, 'E2E Timing', 'PARTNER', 'ACTIVE', now())
     RETURNING id`,
    [email, passwordHash],
  );
  if (rows.length !== 1) throw new Error(`arrangeUserWithPassword: could not create "${email}"`);
}

/**
 * An ADMIN with a password, seeded per spec.
 *
 * Not `E2E_ADMIN_EMAIL`, for the reason `arrangeUserWithPassword` documents: the
 * `login:email:<address>` bucket is 10 per 15 minutes, counts failures, and no header
 * can isolate it. The shared admin address already spends four attempts a run, so a
 * spec that logs in as the founder to exercise a founder-only control should bring its
 * own — otherwise it eats another spec's headroom and the failure looks like a broken
 * login, not a rate limit.
 */
export async function arrangeAdminUser(email: string, password: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await query<{ id: string }>(
    `INSERT INTO "User" (id, email, "passwordHash", name, role, status, "createdAt")
     VALUES (gen_random_uuid()::text, lower($1), $2, 'E2E Founder', 'ADMIN', 'ACTIVE', now())
     RETURNING id`,
    [email, passwordHash],
  );
  if (rows.length !== 1) throw new Error(`arrangeAdminUser: could not create "${email}"`);
  return rows[0].id;
}

/**
 * The plan id and free-period column for a slug — what a trial write must move.
 *
 * `AT TIME ZONE 'UTC'` is load-bearing, and its absence cost an hour: every Prisma
 * `DateTime` is a `TIMESTAMP(3)` **without** a zone, and node-pg parses a bare
 * `timestamp` in the CLIENT's local zone. Read raw from a machine on CEST, a value the
 * app stored as 23:59:59.999Z comes back as 21:59:59.999Z — a two-hour "bug" that
 * exists only in the test helper, and that would flip with the reader's timezone.
 * Casting to `timestamptz` hands pg an offset to parse, so the instant survives.
 */
export async function findTrial(
  tenantSlug: string,
): Promise<{ billingId: string; trialEndsAt: Date | null } | null> {
  const rows = await query<{ id: string; trial_ends_at: Date | null }>(
    `SELECT id, "trialEndsAt" AT TIME ZONE 'UTC' AS trial_ends_at
       FROM "TenantBilling" WHERE "tenantSlug" = $1`,
    [tenantSlug],
  );
  const r = rows[0];
  return r ? { billingId: r.id, trialEndsAt: r.trial_ends_at } : null;
}

/**
 * Audit rows for one action on one entity, newest first.
 *
 * The audit log is the ONLY record of why a trial was extended — the column can say
 * "until when" and never "why" — so a spec that asserted the new date but not the
 * entry would be passing on half the feature.
 */
export async function findAuditEntries(
  action: string,
  entityId: string,
): Promise<{ action: string; meta: Record<string, unknown> | null }[]> {
  return await query<{ action: string; meta: Record<string, unknown> | null }>(
    `SELECT action, meta FROM "AuditLog"
      WHERE action = $1 AND "entityId" = $2
      ORDER BY "createdAt" DESC`,
    [action, entityId],
  );
}

/**
 * Every trial-ending marker a plan has, oldest first.
 *
 * The sweep's send-once record (T-d): one audit row per milestone per trial END
 * DATE, carrying `{endsOn, phase, daysLeft, emailed}`. Read as a LIST rather than
 * counted per action, because the property under test is "exactly one of each, no
 * matter how often the cron fires".
 */
export async function findTrialWarnings(
  entityId: string,
): Promise<{ action: string; meta: Record<string, unknown> | null }[]> {
  return await query<{ action: string; meta: Record<string, unknown> | null }>(
    `SELECT action, meta FROM "AuditLog"
      WHERE "entityId" = $1 AND action LIKE 'billing.trial.ending.%'
      ORDER BY "createdAt" ASC`,
    [entityId],
  );
}

/**
 * Every backup-alert marker the platform holds, oldest first.
 *
 * Platform-wide rather than per-tenant (`entityId = 'backups'`): one mail lists every
 * affected restaurant, so there is no row to hang the marker off. Read as a LIST
 * because the property under test is an ABSENCE — a sweep whose mail never left must
 * leave nothing behind, or the next sweep would treat the silence as already-said.
 */
export async function findBackupAlerts(): Promise<
  { action: string; meta: Record<string, unknown> | null }[]
> {
  return await query<{ action: string; meta: Record<string, unknown> | null }>(
    `SELECT action, meta FROM "AuditLog"
      WHERE "entityId" = 'backups' AND action LIKE 'backup.alert.%'
      ORDER BY "createdAt" ASC`,
  );
}

/**
 * A PARTNER with a password and nothing else.
 *
 * Its own address per call, for the reason `arrangeUserWithPassword` documents: the
 * `login:email:<address>` bucket is 10 per 15 minutes, counts failures, and no header
 * can isolate it — so a spec that logs in as a partner brings its own.
 */
export async function arrangePartnerUser(email: string, password: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await query<{ id: string }>(
    `INSERT INTO "User" (id, email, "passwordHash", name, role, status, "createdAt")
     VALUES (gen_random_uuid()::text, lower($1), $2, 'E2E Domain Partner', 'PARTNER', 'ACTIVE', now())
     RETURNING id`,
    [email, passwordHash],
  );
  if (rows.length !== 1) throw new Error(`arrangePartnerUser: could not create "${email}"`);
  return rows[0].id;
}

/**
 * A base-domain claim, optionally already proven
 * (SOFRA-PARTNER-FLEXIBILITY-PLAN D1b).
 *
 * ARRANGES the row the claim action writes. The verified state cannot be reached
 * through the UI in this suite at all — proving control means publishing a TXT record
 * in a zone we do not own, and the whole point of the check is that nothing but real
 * DNS can satisfy it. So the PROOF is unit-tested (`txtMatchesToken`) and what the
 * verified state UNLOCKS is arranged here.
 */
export async function arrangeBaseDomain(
  partnerId: string,
  domain: string,
  opts: { verified?: boolean; verifiedDaysAgo?: number } = {},
): Promise<{ id: string; verifyToken: string }> {
  const verifiedAt = opts.verified
    ? `now() - make_interval(days => ${Math.trunc(opts.verifiedDaysAgo ?? 1)})`
    : "NULL";
  const rows = await query<{ id: string; verify_token: string }>(
    `INSERT INTO "PartnerDomain"
       (id, "partnerId", domain, "verifyToken", "verifiedAt", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, md5(random()::text) || md5(random()::text),
             ${verifiedAt}, now())
     RETURNING id, "verifyToken" AS verify_token`,
    [partnerId, domain],
  );
  if (rows.length !== 1) throw new Error(`arrangeBaseDomain: could not claim "${domain}"`);
  return { id: rows[0].id, verifyToken: rows[0].verify_token };
}

/** One partner's claim on a domain — what a check or a removal must have moved. */
export async function findBaseDomain(
  partnerId: string,
  domain: string,
): Promise<{ id: string; verified: boolean; checked: boolean } | null> {
  const rows = await query<{ id: string; verified: boolean; checked: boolean }>(
    `SELECT id,
            ("verifiedAt" IS NOT NULL)    AS verified,
            ("lastCheckedAt" IS NOT NULL) AS checked
       FROM "PartnerDomain" WHERE "partnerId" = $1 AND domain = $2`,
    [partnerId, domain],
  );
  const r = rows[0];
  return r ? { id: r.id, verified: r.verified, checked: r.checked } : null;
}

/**
 * A reseller partner with one client, optionally already a live tenant with a plan
 * (SOFRA-PARTNER-PLAN §9).
 *
 * Its own PARTNER user per call rather than the seeded `E2E_PARTNER_EMAIL`, for the
 * reason `arrangeUserWithPassword` documents: `lib/auth.ts` limits
 * `login:email:<address>` to 10 per 15 minutes and no header can isolate that bucket,
 * so sharing one address across specs rate-limits the OTHER specs' logins.
 *
 * ARRANGES a state the founder's own flow produces — a `Client` LIVE with a
 * `tenantSlug`, and a reseller plan hanging off it — rather than driving /admin, which
 * is a different surface's concern and would double the runtime of every case here.
 */
export async function arrangeResellerClient(opts: {
  partnerEmail: string;
  partnerPassword: string;
  restaurantName: string;
  status: string;
  tenantSlug?: string;
  city?: string;
  plan?: {
    amountCents: number;
    interval: string;
    subStatus: string;
    /** The free period's end, as an ISO instant. Omitted = the column stays NULL,
     *  which is what every plan written before T-a means: payable now. */
    trialEndsAtIso?: string;
  };
}): Promise<{ partnerId: string; clientId: string }> {
  const passwordHash = await bcrypt.hash(opts.partnerPassword, 12);
  const partners = await query<{ id: string }>(
    `INSERT INTO "User" (id, email, "passwordHash", name, role, status, "createdAt")
     VALUES (gen_random_uuid()::text, lower($1), $2, 'E2E Reseller', 'PARTNER', 'ACTIVE', now())
     RETURNING id`,
    [opts.partnerEmail, passwordHash],
  );
  const partnerId = partners[0].id;

  const clients = await query<{ id: string }>(
    `INSERT INTO "Client"
       (id, "partnerId", "restaurantName", "contactName", city, status, "tenantSlug",
        "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'E2E Contact', $3, $4::"ClientStatus", $5,
             now(), now())
     RETURNING id`,
    [partnerId, opts.restaurantName, opts.city ?? "Geneva", opts.status, opts.tenantSlug ?? null],
  );
  const clientId = clients[0].id;

  if (opts.plan) {
    if (!opts.tenantSlug) throw new Error("arrangeResellerClient: a plan needs a tenantSlug");
    const billings = await query<{ id: string }>(
      `INSERT INTO "TenantBilling"
         (id, "tenantSlug", name, email, "clientId", "liveSince", "trialEndsAt", "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now(), $5::timestamptz, now())
       RETURNING id`,
      [
        opts.tenantSlug,
        opts.restaurantName,
        opts.partnerEmail.toLowerCase(),
        clientId,
        opts.plan.trialEndsAtIso ?? null,
      ],
    );
    await query(
      `INSERT INTO "BillingSubscription"
         (id, "billingId", description, "amountCents", currency, interval, status, "createdAt")
       VALUES (gen_random_uuid()::text, $1, 'E2E arranged plan', $2, 'EUR', $3,
               $4::"SubscriptionStatus", now())`,
      [billings[0].id, opts.plan.amountCents, opts.plan.interval, opts.plan.subStatus],
    );
  }

  return { partnerId, clientId };
}

/**
 * A bare billing plan for a slug, with a free period that has already lapsed.
 *
 * Deliberately minimal — no partner, no client, no subscription — because the
 * backup page reads exactly two things off a plan: `trialEndsAt`, and whether a
 * subscription is ACTIVE. Building a whole reseller arrangement to set one date
 * would couple this spec to the partner flow, which it does not test.
 *
 * `ON CONFLICT DO NOTHING` on the UNIQUE `tenantSlug`, then an explicit UPDATE:
 * a retried spec must land on the same state rather than fail on the constraint.
 */
export async function arrangeLapsedTrialPlan(
  tenantSlug: string,
  trialEndsAtIso: string,
): Promise<void> {
  await query(
    `INSERT INTO "TenantBilling" (id, "tenantSlug", name, email, "trialEndsAt", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4::timestamptz, now())
     ON CONFLICT ("tenantSlug") DO UPDATE SET "trialEndsAt" = EXCLUDED."trialEndsAt"`,
    [tenantSlug, `E2E ${tenantSlug}`, `${tenantSlug}@example.test`, trialEndsAtIso],
  );
}

/** Every backup artifact ref we hold for a slug. The prune assertion reads this:
 *  an artifact the box stopped listing must actually LEAVE the database, not
 *  merely stop being rendered. */
export async function findBackupArtifactRefs(tenantSlug: string): Promise<string[]> {
  const rows = await query<{ ref: string }>(
    `SELECT ref FROM "BackupArtifact" WHERE "tenantSlug" = $1 ORDER BY ref`,
    [tenantSlug],
  );
  return rows.map((r) => r.ref);
}

export type BackupJobRow = {
  id: string;
  action: string;
  status: string;
  ref: string | null;
  reason: string | null;
  override: boolean;
};

/** Jobs queued for a slug, newest first. */
export async function findBackupJobs(tenantSlug: string): Promise<BackupJobRow[]> {
  return await query<BackupJobRow>(
    `SELECT id, action::text AS action, status::text AS status, ref, reason, override
       FROM "BackupJob" WHERE "tenantSlug" = $1 ORDER BY "createdAt" DESC`,
    [tenantSlug],
  );
}
