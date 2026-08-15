// Can this signup mint its own account, and at what price?
// (SOFRA-ONBOARDING-PLAN O2 — self-serve account + payment.)
//
// The founder path (/admin/onboard) mints an OWNER + a PENDING plan by hand. O2
// lets the public signup do the same thing for itself, which means the intake now
// has to answer two questions it never had to before:
//
//   1. is the wished subdomain actually usable? It stops being a wish the moment
//      it becomes `TenantBilling.tenantSlug` — the unique billing anchor.
//   2. what does the plan cost? Re-quoted from the catalog, never read back from
//      the stored `quotedCents`.
//
// Three outcomes, because "no" has two very different meanings:
//
//   • account  — mint it.
//   • refuse   — the customer can fix this themselves, at the keyboard, by
//                changing one field. Nothing is written; they resubmit.
//   • leadOnly — the customer CANNOT fix this (the email already has an account;
//                they configured nothing to price; the registry is unreadable).
//                The lead is still captured and the founder takes it from there —
//                exactly today's behaviour, which is why this is a degradation
//                and not a rejection.
//
// Two residuals, both accepted on cost alone:
//
//  1. `account: true` vs `account: false` is a weak oracle for "does this email
//     already have an account". Weak because each probe costs a distinct unused
//     slug, leaves a lead row the founder reads, and is capped at 5 per 15 min per
//     IP by `guardIntake`. (This used to be justified by the alternative being a
//     worse lie — telling a real customer "check your email" when none was sent.
//     That lie is gone since G5, so the trade-off now rests on the cost above and
//     nothing else.)
//  2. `emailed: false` (G5) tells an unauthenticated caller that the welcome mail
//     did not go out. `sendEmail` collapses every Resend non-2xx into `{sent:false}`,
//     and that set includes PER-RECIPIENT rejections — a suppressed address after a
//     hard bounce, or the 403 a sandbox sender returns for everyone but the account
//     owner. So a probe can learn something about an address at a third party that
//     it could not otherwise. Same cost cap as (1), and the alternative — hiding a
//     failed send from the one person it strands — is the gap this closed. If
//     `sendEmail` ever returns a reason, echo only the non-recipient-specific ones.
//
// That split is the honest reading of the plan's drop-don't-reject rule
// (lib/signup-configuration.ts): never lose a lead over something the customer
// has no way to resolve, but do ask them to change a subdomain that is taken.
//
// Pure — no DB, no network, no env — so every branch is unit-testable.

import { isModuleId, quoteModules, type ModuleId } from "./module-catalog";
import { parseCsv } from "./tenant-options";
import type { SlugStatus } from "./slug-availability";
import type { StoredSignupConfiguration } from "./signup-configuration";

/** Mirrors Prisma's `UserRole` — kept structural so this module stays DB-free. */
export type ExistingRole = "ADMIN" | "PARTNER" | "OWNER";

/** Mirrors Prisma's `UserStatus`. */
export type ExistingStatus = "INVITED" | "ACTIVE" | "DISABLED";

/** Why the customer is being asked to change something (they can fix all of these). */
export type SelfServeRefusal = "slugInvalid" | "slugReserved" | "slugTaken";

/** Why the signup degraded to a founder-handled lead (the customer cannot fix these). */
export type SelfServeFallback =
  | "alreadySignedUp"
  | "emailAlreadyHasAccount"
  | "accountDisabled"
  | "nothingConfigured"
  | "noSlugChosen"
  | "registryUnavailable";

export type SelfServeOutcome =
  | {
      kind: "account";
      /** The validated subdomain — becomes `TenantBilling.tenantSlug`. */
      slug: string;
      /** Monthly total in EUR integer cents, re-quoted from the catalog. */
      amountCents: number;
      /** The priced module set, `core` included (what the plan is actually for). */
      modules: ModuleId[];
    }
  | { kind: "refuse"; reason: SelfServeRefusal }
  | { kind: "leadOnly"; reason: SelfServeFallback };

export type SelfServeInput = {
  /** `checkSlug()` verdict against the registry AND the already-claimed billing slugs. */
  slugVerdict: SlugStatus;
  /** The trimmed slug the customer asked for. */
  slug: string;
  /**
   * True when the tenant registry was readable. When it was NOT, the `taken` half
   * of `slugVerdict` is unreliable, and this path must not mint anything — see the
   * `registryUnavailable` rule below.
   */
  registryAvailable: boolean;
  /** An existing account with this email, or null when the email is new. */
  existingAccount: { role: ExistingRole; status: ExistingStatus } | null;
  /**
   * True when the slug is already claimed by a plan belonging to THIS email — i.e.
   * this is the same person submitting the same request again, not a collision.
   */
  slugClaimedBySameEmail: boolean;
  /** Output of `sanitizeSignupConfiguration` — already dropped-and-re-quoted. */
  config: StoredSignupConfiguration;
};

/**
 * Decide what a self-serve signup gets.
 *
 * Order matters, and it is the same order `resolveOnboardFlow` uses for the same
 * reason: every refusal is decided BEFORE anything is created, so a rejection can
 * never leave a freshly minted user or a half-built plan behind.
 *
 * The price is recomputed here from the module list rather than read out of
 * `config.quotedCents`. Those two are equal by construction today — the sanitizer
 * writes the quote it computed — but reading the stored number would make a
 * column the customer's POST can influence the input to a charge. Re-quoting
 * makes the catalog the only thing that can set a price, which is the invariant
 * worth protecting even when the shortcut would currently agree.
 */
export function decideSelfServe(input: SelfServeInput): SelfServeOutcome {
  // 0. No slug at all is NOT a refusal. The field was optional before O2 and the
  //    API keeps tolerating its absence, so a cached bundle or a no-JS post from
  //    the pre-O2 form still lands as a lead rather than a 409 the customer can
  //    make no sense of. The live form marks it required, so this is the
  //    compatibility path, not the normal one. A plan cannot be created without
  //    it: `TenantBilling.tenantSlug` is the unique billing anchor.
  if (input.slug === "") return { kind: "leadOnly", reason: "noSlugChosen" };

  // 0b. The same person resubmitting the same request is NOT a slug collision, and
  //     must not be told "that address is already taken" about the address they
  //     themselves just claimed. That is the shape a lost welcome email takes: the
  //     account exists with no password, the customer never got the link, and
  //     resubmitting is the obvious thing to try. Answering `taken` there is a dead
  //     end — no lead, no founder notification, no way in. So it becomes a lead the
  //     founder sees, with a reason that says what actually happened.
  if (input.slugClaimedBySameEmail) return { kind: "leadOnly", reason: "alreadySignedUp" };

  // 1. The subdomain, first: it is immutable after provisioning (trap 3), so it
  //    is the one field worth stopping the customer over while they can still fix it.
  if (input.slugVerdict === "invalid") return { kind: "refuse", reason: "slugInvalid" };
  if (input.slugVerdict === "reserved") return { kind: "refuse", reason: "slugReserved" };
  if (input.slugVerdict === "taken") return { kind: "refuse", reason: "slugTaken" };

  // 2. An unreadable registry makes the `taken` half of the verdict unreliable —
  //    `checkSlug` was handed only the billing slugs, so any LIVE tenant without a
  //    billing row (RUMI, and every founder-provisioned tenant) reads as
  //    available. The founder-side check in `openProvisioningPrAction` fails open
  //    for the same reason, and that is fine THERE because nothing immutable and
  //    no money exists at that point. Here the next step is a real charge on a
  //    `live_` key against someone else's subdomain, with a manual refund as the
  //    only remedy. A signup deferred to the founder is far cheaper.
  if (!input.registryAvailable) return { kind: "leadOnly", reason: "registryUnavailable" };

  // 3. Never bind a plan to an account this anonymous POST has not proven control
  //    of. A brand-new email is self-verifying: the account is created with no
  //    password and the invite link is the proof. An EXISTING account is not —
  //    anyone who knows an owner's address could otherwise create a priced plan
  //    on it and have us email them "a new plan is waiting", putting a pay button
  //    for a restaurant they never ordered on their dashboard.
  //
  //    So every existing account degrades to a founder-handled lead, including an
  //    existing OWNER adding a second restaurant. That case is legitimate and will
  //    want a signed-in "add a restaurant" flow; until it has one, the founder is
  //    the authenticated path. A DISABLED account is called out separately because
  //    it is the one that used to fail worst: it would take the account branch,
  //    get no invite token (only INVITED accounts do), and be sent "sign in to
  //    your dashboard" for an account `lib/auth.ts` and `forgotPasswordAction`
  //    both refuse — an unpayable plan holding a slug forever.
  if (input.existingAccount) {
    return {
      kind: "leadOnly",
      reason:
        input.existingAccount.status === "DISABLED" ? "accountDisabled" : "emailAlreadyHasAccount",
    };
  }

  // 4. A plan needs something to price. The live form always posts `core` (a
  //    hidden input), so this is the plain-form / stale-bundle case that the
  //    sanitizer reports as NOTHING_CHOSEN. Inventing "core only" here would put
  //    words in the customer's mouth AND charge them for the guess.
  const modules = parseCsv(input.config.modules).filter(isModuleId);
  if (modules.length === 0) return { kind: "leadOnly", reason: "nothingConfigured" };

  return {
    kind: "account",
    slug: input.slug,
    amountCents: quoteModules(modules).monthlyCents,
    modules,
  };
}
