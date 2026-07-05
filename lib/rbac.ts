// Server-side role gate — call at the top of EVERY control-plane page and
// server action (defense in depth; layouts alone don't protect nested routes).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = { id: string; email: string; name: string; role: "ADMIN" | "PARTNER" };

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user as (SessionUser & { id?: string }) | undefined;
  if (!user?.id) redirect("/login");
  return user as SessionUser;
}

export async function requireRole(role: "ADMIN" | "PARTNER"): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) {
    // Wrong area for this role — send them to their own home, not an error page.
    redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  return user;
}

export const requireAdmin = () => requireRole("ADMIN");
export const requirePartner = () => requireRole("PARTNER");
