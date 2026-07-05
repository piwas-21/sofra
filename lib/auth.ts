// Auth.js v5, credentials + JWT sessions (ADR-008). Chosen over NextAuth v4
// (domainio's version) because sofra is React 19 / Next 15.5 and v4 pins
// React <=18 peer deps. Same model: bcrypt-hashed passwords, no DB sessions.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

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

        const user = await db.user.findUnique({ where: { email } });
        // Generic failure regardless of which check failed — no user enumeration.
        if (!user || !user.passwordHash || user.status !== "ACTIVE") {
          await audit(null, "login.failed", "User", null, { email });
          return null;
        }
        const ok = await compare(password, user.passwordHash);
        if (!ok) {
          await audit(user.id, "login.failed", "User", user.id);
          return null;
        }
        await audit(user.id, "login.success", "User", user.id);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
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
