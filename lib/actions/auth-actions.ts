"use server";

import { AuthError } from "next-auth";
import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { siteUrl } from "@/lib/email";
import { createToken, findValidToken } from "@/lib/tokens";
import { resendPlan } from "@/lib/invite-resend";
import { controlLocale } from "@/lib/control-locale";
import { sendPasswordResetEmail } from "@/lib/reset-email";
import { sendInviteEmail } from "@/lib/self-serve-email";
import { formEmail, limited, type FormState } from "@/lib/auth-form";

// Re-exported so every form component keeps ONE import for the auth flow it
// belongs to. Type-only, so it does not violate the `"use server"` rule that a
// module may export nothing but async functions.
export type { FormState };

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await limited("login", 20)) return { error: "tooManyAttempts" };
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "wrongCredentials" };
    }
    throw e; // NEXT_REDIRECT on success
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/** Shared by invite (first password) and reset flows. */
export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await limited("set-password", 10)) return { error: "tooManyAttempts" };

  const raw = String(formData.get("token") ?? "");
  const purpose = formData.get("purpose") === "reset" ? "reset" : "invite";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 10) return { error: "passwordTooShort" };
  if (password !== confirm) return { error: "passwordMismatch" };

  const token = await findValidToken(raw, purpose);
  // A DISABLED account must not reactivate itself through a leftover token.
  if (!token || token.user.status === "DISABLED") {
    return { error: "linkInvalid" };
  }

  const passwordHash = await hash(password, 12);
  // The one moment a customer is CERTAINLY present with a language chosen (G9):
  // they are on our page, having followed a link from a mail, with the site's own
  // locale cookie set. The account's stored locale came from an intake row that
  // may be months old — or, for a founder-created account, from nothing at all —
  // so this is where it stops being a guess. Written inside the same transaction
  // as the password: a locale that lands only when a separate write succeeds is a
  // locale that silently disagrees with what the person just read.
  const locale = await controlLocale();
  await db.$transaction([
    db.user.update({
      where: { id: token.userId },
      // Only the INVITED→ACTIVE transition; an already-ACTIVE user resetting
      // their password keeps their current status.
      data: {
        passwordHash,
        locale,
        ...(token.user.status === "INVITED" ? { status: "ACTIVE" as const } : {}),
      },
    }),
    db.inviteToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  await audit(token.userId, `password.set.${purpose}`, "User", token.userId);
  redirect("/login?set=1");
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await limited("forgot", 5)) return { error: "tooManyAttempts" };

  // Always report success — no user enumeration via this form.
  const generic: FormState = { ok: true };
  const email = formEmail(formData);
  if (!email) return generic;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status === "DISABLED") return generic;

  const raw = await createToken(user.id, "reset");
  const link = `${siteUrl()}/reset/${raw}`;
  // Kept, not discarded (G16). The caller cannot be told — this form answers the same generic
  // success to everyone, on purpose, so it cannot be used to probe which addresses exist — which is
  // exactly why the failure has to land somewhere a human will see it. A locked-out owner who is
  // told "check your email" for a mail that never left has no next move at all.
  // The template lives in lib/reset-email.ts — in the reader's own language (G9)
  // and no longer calling every recipient a PARTNER (G10).
  //
  // Caught for the anti-enumeration property this form exists to have: `fetch`
  // REJECTS on a DNS/connect failure, so an unreachable transport would throw for
  // an address that HAS an account while an address that does not still answers
  // the generic success above — a live "is this registered" oracle, during exactly
  // the incident nobody is watching. It also saves the `emailed: false` row, which
  // is the failure most worth recording.
  const reset = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    url: link,
  }).catch(() => ({ sent: false }));
  await audit(user.id, "password.reset.requested", "User", user.id, { emailed: reset.sent });
  return generic;
}

/**
 * "Send me that invite again" (G12).
 *
 * The 24h invite token is a restaurant owner's ONLY way into an account that has
 * no password yet, and until now its expiry was a dead end: the invite page said
 * *"reply to your approval email"*, and the founder's own `/admin/signups` badge
 * told him to hand the link over by hand. That is a support ticket per expiry, in
 * a funnel whose whole point is that nobody has to be watching.
 *
 * Same posture as `forgotPasswordAction`, and for the same reason — it answers the
 * SAME generic sentence to every address, so it cannot be used to probe which
 * restaurants have an account. What differs is what leaves: `resendPlan` decides,
 * and the anti-enumeration answer below does not depend on it.
 */
export async function resendInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Tighter than login's 20 and equal to `forgot`'s 5: this one SENDS MAIL to an
  // address the caller names, so an unlimited form is a way to have our verified
  // sending domain deliver repeats to a stranger's inbox.
  if (await limited("resend-invite", 5)) return { error: "tooManyAttempts" };

  const generic: FormState = { ok: true };
  const email = formEmail(formData);
  if (!email) return generic;

  const user = await db.user.findUnique({
    where: { email },
    include: { billingsPaid: { select: { tenantSlug: true }, take: 1 } },
  });
  const plan = resendPlan(user);
  if (!user || plan.kind === "none") return generic;

  let token: string | null = null;
  if (plan.kind === "invite") {
    // Retire the older unused invites first. They are single-use but they are not
    // single-LIVE, so without this a 24h-old link and a fresh one both open the
    // same account, and the mail the owner is reading is not necessarily the one
    // that works. The newest link is the one we just told them about.
    await db.inviteToken.updateMany({
      where: { userId: user.id, purpose: "invite", usedAt: null },
      data: { usedAt: new Date() },
    });
    token = await createToken(user.id, "invite");
  }

  // The tenant name is not on `User`. `billingsPaid` is the OWNER's own plan
  // (ADR-004), which is the closest thing this flow has to "which restaurant" —
  // and a PARTNER, who pays for someone else's, correctly falls through to the
  // neutral wording rather than being told the name of a client's restaurant.
  const invite = await sendInviteEmail({
    to: user.email,
    name: user.name,
    restaurantName: user.billingsPaid[0]?.tenantSlug ?? "Your restaurant",
    inviteToken: token,
    locale: user.locale,
    // Caught for the same reason `forgotPasswordAction` catches: `fetch` REJECTS on
    // a DNS/connect failure, so an unreachable transport would throw for an address
    // that HAS an account while an unknown address still got the generic success —
    // a live "is this registered" oracle, during exactly the incident nobody is
    // watching.
  }).catch(() => ({ sent: false }));

  // G16-shaped: written either way, carrying the verdict, so a founder can see that
  // a re-send did not leave rather than infer it from a customer complaining twice.
  await audit(user.id, "invite.resend.requested", "User", user.id, {
    emailed: invite.sent,
    kind: plan.kind,
  });
  return generic;
}
