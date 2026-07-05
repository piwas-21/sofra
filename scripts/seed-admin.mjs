// Idempotent founder-account seed. Run once per environment:
//   ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=… DATABASE_URL=… node scripts/seed-admin.mjs
// Uses pg directly (no Prisma runtime needed) so it works in the slim
// production image. Credentials come from env — never hardcoded (cf. the
// RUMI backend's seeder-password lesson, backend #116).
import { randomUUID } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, DATABASE_URL } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !DATABASE_URL) {
  console.error("seed-admin: set ADMIN_EMAIL, ADMIN_PASSWORD (and DATABASE_URL)");
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
  console.error("seed-admin: ADMIN_PASSWORD must be at least 12 characters");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const res = await client.query(
    `INSERT INTO "User" (id, email, "passwordHash", name, role, status, "createdAt")
     VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE', now())
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [randomUUID(), ADMIN_EMAIL.toLowerCase(), hash, ADMIN_NAME ?? "Founder"],
  );
  console.log(
    res.rowCount === 1
      ? `seed-admin: created ADMIN ${ADMIN_EMAIL}`
      : `seed-admin: ${ADMIN_EMAIL} already exists — nothing changed`,
  );
} finally {
  await client.end();
}
