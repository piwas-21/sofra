import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { founderInbox, escapeHtml } from "@/lib/email";
import { guardIntake } from "@/lib/intake";
import { signupSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { sanitizeSignupConfiguration } from "@/lib/signup-configuration";
import { eur } from "@/lib/format";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { checkSlug } from "@/lib/slug-availability";
import { createSelfServeAccount, SlugRaceLostError } from "@/lib/self-serve-account";
import {
  decideSelfServe,
  type ExistingRole,
  type ExistingStatus,
  type SelfServeFallback,
  type SelfServeOutcome,
} from "@/lib/self-serve-signup";
import { sendFounderSignupNotice, sendOwnerWelcome } from "@/lib/self-serve-email";

/** What the founder is told when the intake could not mint an account. Stated
 *  outright, because self-serve means nobody is watching the queue for a lead
 *  that quietly failed to become one. Founder-facing English only — this is not
 *  customer copy and is deliberately not localized. */
const FOUNDER_FALLBACK_NOTES: Record<SelfServeFallback, string> = {
  alreadySignedUp:
    "No account: this email already has a plan for this exact web address — the same person resubmitting. Usually means they never received the welcome email. Re-issue at /admin/onboard on the same email and hand the link over directly — NOT 'Forgot password', which runs through the same mailer and reports success whether or not it sent.",
  emailAlreadyHasAccount:
    "No account: that email already has one. An anonymous POST can't prove control of an existing mailbox, so this needs you (or a signed-in 'add a restaurant' flow, which doesn't exist yet).",
  accountDisabled:
    "No account: that email belongs to a DISABLED account, which cannot log in or reset. Re-enable it first, or use a different address.",
  nothingConfigured:
    "No account: the signup carried no product choices, so there was nothing to price.",
  noSlugChosen:
    "No account: no web address was requested, and the plan's billing anchor is the slug. Agree one, then use /admin/onboard.",
  registryUnavailable:
    "No account: the tenant registry could not be read, so the requested web address could not be checked against live tenants. Check the registry bind-mount, then onboard by hand.",
};

/**
 * Create the account + PENDING plan and say what happened, for the founder.
 *
 * Split out of the handler so the route reads as its flow (guard → validate →
 * decide → mint → notify) and stays under the cognitive-complexity gate.
 */
async function mintAccount(
  outcome: Extract<SelfServeOutcome, { kind: "account" }>,
  who: { email: string; contactName: string; restaurantName: string; locale: string },
  signupRequestId: string,
): Promise<{ account: boolean; emailed: boolean; founderOutcome: string }> {
  let minted;
  try {
    minted = await createSelfServeAccount({
      ...who,
      slug: outcome.slug,
      amountCents: outcome.amountCents,
      signupRequestId,
    });
  } catch (e) {
    if (!(e instanceof SlugRaceLostError)) throw e;
    // Lost a same-second race for the subdomain. The lead is already saved, so
    // report it as founder-handled rather than 409ing a row that now exists — a
    // 409 here would invite a resubmit and a duplicate lead.
    return {
      account: false,
      emailed: false,
      founderOutcome:
        "No account: the requested web address was claimed by another signup moments earlier. Needs a new slug.",
    };
  }

  // The welcome email is the customer's ONLY way into an account that has no
  // password yet, so its failure has to reach the founder — who can still hand the
  // invite over, which is what makes this recoverable at all. Both failure shapes
  // are covered: `sendEmail` swallows a non-2xx into `{sent:false}`, while `fetch`
  // itself REJECTS on a DNS/connect failure. Letting that reject escape would 500
  // the route after the plan committed AND skip the founder notification — losing
  // the backstop exactly when it is needed.
  const welcome = await sendOwnerWelcome({
    to: who.email,
    contactName: who.contactName,
    restaurantName: who.restaurantName,
    slug: outcome.slug,
    amountCents: outcome.amountCents,
    inviteToken: minted.inviteToken,
    // The language the visitor filled the form in (G9) — the same value stored on
    // the lead and now on the account itself, so the welcome mail and everything
    // that follows it speak one language.
    locale: who.locale,
  }).catch(() => ({ sent: false }));

  // Durable, because the founder notice that carries this news is itself an
  // email: whatever broke the welcome (no key, no sender, Resend refusing) may
  // well break that one too, and then nobody would ever learn. The audit row is
  // in the database before either mail is attempted to matter.
  if (!welcome.sent) {
    await audit(null, "signup.welcome.failed", "SignupRequest", signupRequestId, {
      tenantSlug: outcome.slug,
    });
    // Also to the box log, id only (§5.8 — no address, no name): /admin/audit is an
    // unfiltered last-200 table that truncates the entity id, so the audit row alone
    // is not something a founder can act on at 2am.
    console.error("signup: welcome email failed", signupRequestId);
  }

  const plan = `${eur(outcome.amountCents)}/mo`;
  return {
    account: true,
    emailed: welcome.sent,
    founderOutcome: welcome.sent
      ? `Account + PENDING plan created (${plan}). The owner pays from their own dashboard.`
      : `Account + PENDING plan created (${plan}), but the WELCOME EMAIL FAILED — the owner has no password and no link. Re-issue at /admin/onboard on the same email and HAND THE LINK OVER directly (the page shows it). Do NOT send them to "Forgot password": same transport, same failure, and it reports success either way.`,
  };
}

/**
 * Public direct-restaurant signup intake (ADR-004 self-serve; O2).
 *
 * O1 made this collect product choices. O2 makes it act on them: the intake now
 * creates the OWNER account and its PENDING plan itself, so the customer can pay
 * without the founder minting anything at /admin/onboard. That page stays — it is
 * the founder override and the reseller-partner path, unchanged.
 *
 * Three answers, matching `decideSelfServe`:
 *   200 {ok, account:true}  — account + plan created; a set-password email is out.
 *   200 {ok, account:false} — lead captured, founder will take it (the customer
 *                             could not have fixed the reason themselves).
 *   409 {ok:false, reason}  — the subdomain is taken/reserved. NOTHING is written;
 *                             the form asks for another and they resubmit.
 *
 * The 409 is the one case that does not persist a lead, and it is deliberate: the
 * customer is still at the keyboard and one field away from succeeding, so asking
 * is better than banking a lead nobody can act on until the slug is renegotiated.
 */
export async function POST(request: Request) {
  const guard = await guardIntake(request, "signup");
  if ("response" in guard) return guard.response;

  const parsed = signupSchema.safeParse(guard.body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const data = parsed.data;
  // Unknown ids are dropped and the price is recomputed from the catalog — the
  // posted quotedCents is never stored. See lib/signup-configuration.
  const config = sanitizeSignupConfiguration(data);
  const email = data.email.toLowerCase();
  const slug = (data.desiredSlug ?? "").trim();

  // ── Decide before writing anything ──────────────────────────────────────
  // "Taken" spans two namespaces and both matter: a slug already in the registry
  // (a live tenant) and a slug already claimed by a TenantBilling (someone else's
  // unpaid plan is holding it). Reading both here is what makes the 409 accurate;
  // the unique constraint in createSelfServeAccount is the tiebreaker for the
  // races this read cannot see.
  //
  // An unreadable registry fails OPEN on `taken` for the same reason
  // openProvisioningPrAction does — the founder-side check before anything
  // immutable exists is the authority, and a missing bind-mount must not stop
  // signups.
  const registry = await loadTenantRegistry();
  // One row, not the table: the only question is whether THIS slug is claimed.
  const claimedByBilling = slug
    ? await db.tenantBilling.findUnique({
        where: { tenantSlug: slug },
        select: { tenantSlug: true, email: true },
      })
    : null;
  const claimed = [
    ...(registry.ok ? registry.tenants.map((t) => t.slug) : []),
    ...(claimedByBilling ? [claimedByBilling.tenantSlug] : []),
  ];
  const existing = await db.user.findUnique({
    where: { email },
    select: { role: true, status: true },
  });
  const outcome = decideSelfServe({
    slug,
    slugVerdict: checkSlug(slug, claimed),
    registryAvailable: registry.ok,
    slugClaimedBySameEmail: claimedByBilling?.email.toLowerCase() === email,
    existingAccount: existing
      ? { role: existing.role as ExistingRole, status: existing.status as ExistingStatus }
      : null,
    config,
  });

  if (outcome.kind === "refuse") {
    return NextResponse.json({ ok: false, reason: outcome.reason }, { status: 409 });
  }

  // ── The lead row, exactly as before ─────────────────────────────────────
  const signup = await db.signupRequest.create({
    data: {
      restaurantName: data.restaurantName,
      contactName: data.contactName,
      email,
      phone: data.phone || null,
      city: data.city || null,
      // The lead's WISH, recorded verbatim. Still unvalidated HERE — the decision
      // above already refused an unusable one, so what reaches this column is
      // either usable or (on the leadOnly path) a slug the founder will look at.
      desiredSlug: data.desiredSlug || null,
      message: data.message || null,
      locale: data.locale,
      ...config,
    },
  });
  await audit(null, "signup.requested", "SignupRequest", signup.id);

  // ── Mint the account when the decision says so ──────────────────────────
  const { account, emailed, founderOutcome } =
    outcome.kind === "account"
      ? await mintAccount(
          outcome,
          {
            email,
            contactName: data.contactName,
            restaurantName: data.restaurantName,
            locale: data.locale,
          },
          signup.id,
        )
      : { account: false, emailed: false, founderOutcome: FOUNDER_FALLBACK_NOTES[outcome.reason] };

  // ── Tell the founder what happened ─────────────────────────────────────
  // Also non-fatal. Everything the customer needs is already committed; failing
  // the request now would tell them to try again and duplicate the lead, to no
  // benefit — the row is in `/admin/signups` either way.
  const to = founderInbox();
  if (to) {
    await sendFounderSignupNotice({
      to,
      replyTo: data.email,
      restaurantName: data.restaurantName,
      outcome: founderOutcome,
      messageHtml: data.message
        ? `<p style="margin:12px 0 0;">${escapeHtml(data.message)}</p>`
        : "",
      rows: [
        ["Restaurant", data.restaurantName],
        ["Contact", data.contactName],
        ["Email", data.email],
        ["Phone", data.phone || "—"],
        ["City", data.city || "—"],
        ["Desired slug", data.desiredSlug || "—"],
        ["Language", data.locale],
        // The sanitized choices, so the founder reads what will actually be
        // provisioned rather than what was posted.
        ["Modules", config.modules ?? "—"],
        ["Theme", config.template ?? "—"],
        ["Tenant languages", config.languages ?? "—"],
        ["Currency", config.currency ?? "—"],
        ["Quoted", config.quotedCents === null ? "—" : `${eur(config.quotedCents)}/mo`],
      ],
    }).catch(() => undefined);
  }

  // `emailed` is the G5 fix: the form used to say "check your email to set your
  // password" on every account it created, including the ones whose welcome mail
  // never left — sending the customer to an inbox that will never receive it,
  // and to a "Forgot password" that fails the same way. Present only when there
  // IS an account, so the next consumer cannot read a meaningless false off the
  // lead-only answer.
  return NextResponse.json({ ok: true, account, ...(account ? { emailed } : {}) });
}
