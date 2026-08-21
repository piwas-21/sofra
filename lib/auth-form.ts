// The two pieces every auth FORM shares: how a failure is reported, and what
// counts as an address.
//
// A plain module rather than part of `auth-actions.ts`: a `"use server"` file may
// only export async functions, and these are a type, a guard and a rate-limit
// helper. Keeping them here also keeps the actions file inside CLAUDE.md §4.

import { headers } from "next/headers";
import { clientIpFromXff, rateLimit } from "@/lib/rate-limit";

/** `error` is a message key in the `auth.errors` namespace, translated at
 *  render by <ActionError /> (control-plane i18n, sofra #9). */
export type FormState = { error?: string; ok?: boolean };

/** True when this client has spent its allowance for `scope` in the last 15
 *  minutes. Keyed on the IP the edge saw, not on the address typed in: the point
 *  is to bound what ONE caller can make us do, and the address is their input. */
export async function limited(scope: string, max: number): Promise<boolean> {
  const h = await headers();
  const ip = clientIpFromXff(h.get("x-forwarded-for"));
  return !rateLimit(`${scope}:${ip}`, max, 15 * 60 * 1000);
}

/**
 * The address a self-service recovery form was given, or null if it is not one.
 *
 * Shared by both anti-enumeration forms so they cannot drift on what counts as an
 * address — and written WITHOUT the ambiguous `[^\s@]+\.[^\s@]+` tail the first
 * version copied around: `.` is inside that class, so the engine can split a long
 * domain in exponentially many ways and a hostile address turns a validity check
 * into a CPU bill. Excluding the dot from the label class makes the match linear.
 *
 * A shape check, not a deliverability check. The only proof an address exists is a
 * mail that arrives.
 */
export function formEmail(formData: FormData): string | null {
  const value = formData.get("email");
  const email = (typeof value === "string" ? value : "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) ? email : null;
}
