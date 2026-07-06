"use server";

import { AuthError } from "next-auth";
import { hash } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail } from "@/lib/email-templates";
import { createToken, findValidToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/rate-limit";

export type FormState = { error?: string; ok?: boolean };

async function limited(scope: string, max: number): Promise<boolean> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return !rateLimit(`${scope}:${ip}`, max, 15 * 60 * 1000);
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await limited("login", 20)) return { error: "Too many attempts. Try again later." };
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "Wrong email or password." };
    }
    throw e; // NEXT_REDIRECT on success
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/** Shared by invite (first password) and reset flows. */
export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await limited("set-password", 10)) return { error: "Too many attempts. Try again later." };

  const raw = String(formData.get("token") ?? "");
  const purpose = formData.get("purpose") === "reset" ? "reset" : "invite";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  const token = await findValidToken(raw, purpose);
  // A DISABLED account must not reactivate itself through a leftover token.
  if (!token || token.user.status === "DISABLED") {
    return { error: "This link is invalid or has expired. Ask for a new one." };
  }

  const passwordHash = await hash(password, 12);
  await db.$transaction([
    db.user.update({
      where: { id: token.userId },
      // Only the INVITED→ACTIVE transition; an already-ACTIVE user resetting
      // their password keeps their current status.
      data: { passwordHash, ...(token.user.status === "INVITED" ? { status: "ACTIVE" as const } : {}) },
    }),
    db.inviteToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  await audit(token.userId, `password.set.${purpose}`, "User", token.userId);
  redirect("/login?set=1");
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await limited("forgot", 5)) return { error: "Too many attempts. Try again later." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Always report success — no user enumeration via this form.
  const generic: FormState = { ok: true };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status === "DISABLED") return generic;

  const raw = await createToken(user.id, "reset");
  const link = `${siteUrl()}/reset/${raw}`;
  await sendEmail({
    to: user.email,
    subject: "Sofra — reset your password",
    html: craftEmail({
      kicker: "Partner area",
      title: "Reset your password",
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0;">Someone (hopefully you) asked to reset your Sofra partner password. If this wasn't you, you can safely ignore this email.</p>`,
      cta: { label: "Set a new password", url: link },
      footerNote: "The link works once and expires in 24 hours.",
    }),
  });
  await audit(user.id, "password.reset.requested", "User", user.id);
  return generic;
}
