import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "PARTNER";
    } & DefaultSession["user"];
  }
  interface User {
    role?: "ADMIN" | "PARTNER";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "ADMIN" | "PARTNER";
  }
}
