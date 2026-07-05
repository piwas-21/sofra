// Invite / password-reset tokens. The raw token goes in the email link only;
// the DB stores a SHA-256 hash. Single-use, 24h expiry.
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export async function createToken(
  userId: string,
  purpose: "invite" | "reset",
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.inviteToken.create({
    data: {
      userId,
      tokenHash: hash(raw),
      purpose,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return raw;
}

/** Returns the token row (with user) iff valid, unexpired and unused. */
export async function findValidToken(raw: string, purpose: "invite" | "reset") {
  if (!raw || raw.length > 200) return null;
  const token = await db.inviteToken.findUnique({
    where: { tokenHash: hash(raw) },
    include: { user: true },
  });
  if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt < new Date()) {
    return null;
  }
  return token;
}
