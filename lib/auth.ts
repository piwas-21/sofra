// Auth.js v5, credentials + JWT sessions (ADR-008). Chosen over NextAuth v4
// (domainio's version) because sofra is React 19 / Next 15.5 and v4 pins
// React <=18 peer deps. Same model: bcrypt-hashed passwords, no DB sessions.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

// Compared against when the user doesn't exist / isn't ACTIVE, so the
// failure path costs one bcrypt round-trip either way (no timing-based
// user enumeration). Hash of random bytes — matches no real password.
const DUMMY_HASH = "$2b$12$5iWfDPFtlJusJe4KhyQFIOPx/FjFtshCkr7CoRlYMK/oYL/bRFT7i";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // Rate-limit HERE, not (only) in the login server action — the
        // /api/auth/callback/credentials endpoint can be POSTed directly.
        // Keyed by IP and by account so one IP can't spray many accounts
        // and one account can't be brute-forced from many IPs cheaply.
        const h = await headers();
        const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        const windowMs = 15 * 60 * 1000;
        if (!rateLimit(`login:ip:${ip}`, 20, windowMs) || !rateLimit(`login:email:${email}`, 10, windowMs)) {
          await audit(null, "login.rate_limited", "User", null, { email });
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });
        const eligible = Boolean(user?.passwordHash) && user?.status === "ACTIVE";
        // Always burn one bcrypt compare; single generic failure branch.
        const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!eligible || !ok) {
          await audit(user?.id ?? null, "login.failed", "User", user?.id ?? null, { email });
          return null;
        }
        await audit(user!.id, "login.success", "User", user!.id);
        return { id: user!.id, email: user!.email, name: user!.name, role: user!.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});
