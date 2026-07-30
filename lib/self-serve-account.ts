// Mint a self-serve OWNER account and its PENDING plan (SOFRA-ONBOARDING-PLAN O2).
//
// The founder twin of this is `onboardPartnerAction` + `defineTenantPlan`; this
// is the same write, performed by the public intake on the customer's behalf. It
// deliberately enters the EXISTING billing state machine at exactly the point the
// founder path does — a PENDING plan with `payerUserId` set and no CRM Client —
// so `startFirstPayment`, the Mollie webhook, the ACTIVATING claim and the
// mandate-race 503 are all untouched. O2 adds no new billing state.
//
// Two properties are load-bearing:
//
//   1. ONE transaction. Account + billing anchor + PENDING subscription + invite
//      token commit together or not at all. A rolled-back account with a live
//      invite link would be a working email pointing at nothing; a plan with no
//      account would be an unpayable charge sitting in the founder's queue.
//   2. The unique `tenantSlug` is the ARBITER of a slug race. Two people
//      submitting the same subdomain in the same second both pass the read-time
//      check; the loser's INSERT violates the constraint and the whole
//      transaction unwinds. The caller turns that into the same "choose another
//      address" answer the read-time check gives, so the race has no separate
//      failure mode to reason about.
//
// Email verification is NOT a new mechanism here. The account is created INVITED
// with a null `passwordHash`, and `lib/auth.ts` already refuses to log in anyone
// who is not ACTIVE with a password set. The set-password invite link is
// therefore the verification: only someone who can read the mailbox can turn the
// account into one that works. That is the same proof a bespoke "verify your
// email" token would give, with no second token purpose to keep correct.

import { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createToken } from "@/lib/tokens";
import { BILLING_INTERVALS } from "@/lib/billing";

/** What the caller needs to tell the payer what happens next. */
export type SelfServeAccount = {
  userId: string;
  billingId: string;
  /** Raw set-password token — null when the account already has a password
   *  (a returning owner adding a second restaurant just logs in). */
  inviteToken: string | null;
};

/** The slug was claimed by someone else between the check and the insert. */
export class SlugRaceLostError extends Error {
  constructor() {
    super("tenantSlug was claimed concurrently");
    this.name = "SlugRaceLostError";
  }
}

/**
 * Was this specifically the `tenantSlug` unique constraint?
 *
 * Narrowed on the target on purpose: two concurrent signups from the SAME email
 * violate `User.email` instead, and reporting that as "the web address was
 * claimed by another signup" would send the founder looking for a slug conflict
 * that never happened. Anything else propagates as the error it is.
 */
const isSlugCollision = (e: unknown): boolean => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((f) => f.includes("tenantSlug"));
};

export async function createSelfServeAccount(input: {
  email: string;
  contactName: string;
  restaurantName: string;
  slug: string;
  amountCents: number;
}): Promise<SelfServeAccount> {
  try {
    const minted = await db.$transaction(async (tx) => {
      // `decideSelfServe` has already sent every EXISTING account to the founder,
      // so in the ordinary case this finds nothing and the user is created. The
      // lookup stays as the race guard: if a second signup for the same new email
      // committed between that decision and this transaction, creating blindly
      // would violate `User.email` and 500 after the lead row was already written.
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      const user =
        existing ??
        (await tx.user.create({
          data: {
            email: input.email,
            name: input.contactName,
            role: "OWNER",
            // No password: the invite link sets it, and until it does
            // lib/auth.ts refuses the login. This IS the email verification.
            status: "INVITED",
          },
        }));

      const billing = await tx.tenantBilling.create({
        data: {
          tenantSlug: input.slug,
          name: input.contactName,
          email: input.email,
          // Created on demand by `startFirstPayment`, like the founder path.
          mollieCustomerId: null,
          // Owner flow: the payer IS the user, and there is no reseller Client
          // (the clientId XOR payerUserId shape `defineTenantPlan` asserts).
          payerUserId: user.id,
        },
      });

      await tx.billingSubscription.create({
        data: {
          billingId: billing.id,
          description: input.restaurantName,
          amountCents: input.amountCents,
          interval: BILLING_INTERVALS.month.mollie,
          status: "PENDING",
        },
      });

      // Only mint a set-password token for an account that has no password. A
      // returning owner already has working credentials; handing them a second
      // set-password link would invite them to reset a password they know.
      const inviteToken =
        user.status === "INVITED" ? await createToken(user.id, "invite", tx) : null;

      return { userId: user.id, billingId: billing.id, inviteToken };
    });

    // Audited after the commit: an audit row for a transaction that rolled back
    // would be a record of something that never happened. The actor is null —
    // this write has no operator behind it, which is the whole point of O2.
    await audit(null, "signup.selfserve.account", "TenantBilling", minted.billingId, {
      tenantSlug: input.slug,
      amountCents: input.amountCents,
    });
    return minted;
  } catch (e) {
    if (isSlugCollision(e)) throw new SlugRaceLostError();
    throw e;
  }
}
