// Server-side role gate — call at the top of EVERY control-plane page and
// server action (defense in depth; layouts alone don't protect nested routes).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type UserRole = "ADMIN" | "PARTNER" | "OWNER";
export type SessionUser = { id: string; email: string; name: string; role: UserRole };

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user as (SessionUser & { id?: string }) | undefined;
  if (!user?.id) redirect("/login");
  return user as SessionUser;
}

export async function requireRole(role: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) {
    // Wrong area for this role — send them to their own home, not an error page.
    // PARTNER and OWNER both live under /dashboard; only ADMIN has /admin.
    redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  return user;
}

/** The /dashboard is shared by PARTNER (reseller CRM) and OWNER (own plan). It's
 *  an explicit allowlist — only those two roles pass; an ADMIN is bounced to
 *  /admin (a requireRole here would loop, since /dashboard is also the
 *  OWNER/PARTNER home), and any future role is denied rather than silently
 *  admitted. */
export async function requirePartnerOrOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "PARTNER" && user.role !== "OWNER") {
    redirect(user.role === "ADMIN" ? "/admin" : "/login");
  }
  return user;
}

export const requireAdmin = () => requireRole("ADMIN");
export const requirePartner = () => requireRole("PARTNER");
