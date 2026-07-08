// Seed a throwaway ADMIN + ACTIVE PARTNER for the Playwright smoke. Idempotent
// (ON CONFLICT DO NOTHING). Credentials come from env — CI generates random
// throwaway values against a disposable postgres service container; NEVER run
// this against a real DB (it would mint a login-capable account).
//   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… E2E_PARTNER_EMAIL=… E2E_PARTNER_PASSWORD=… \
//   DATABASE_URL=… node scripts/seed-e2e.mjs
import { randomUUID } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_PARTNER_EMAIL,
  E2E_PARTNER_PASSWORD,
  DATABASE_URL,
} = process.env;

const missing = [
  ["E2E_ADMIN_EMAIL", E2E_ADMIN_EMAIL],
  ["E2E_ADMIN_PASSWORD", E2E_ADMIN_PASSWORD],
  ["E2E_PARTNER_EMAIL", E2E_PARTNER_EMAIL],
  ["E2E_PARTNER_PASSWORD", E2E_PARTNER_PASSWORD],
  ["DATABASE_URL", DATABASE_URL],
].filter(([, v]) => !v);
if (missing.length) {
  console.error(`seed-e2e: missing env: ${missing.map(([k]) => k).join(", ")}`);
  process.exit(1);
}
for (const [k, v] of [["E2E_ADMIN_PASSWORD", E2E_ADMIN_PASSWORD], ["E2E_PARTNER_PASSWORD", E2E_PARTNER_PASSWORD]]) {
  if (v.length < 12) {
    console.error(`seed-e2e: ${k} must be at least 12 characters`);
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  for (const [email, password, name, role] of [
    [E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, "E2E Admin", "ADMIN"],
    [E2E_PARTNER_EMAIL, E2E_PARTNER_PASSWORD, "E2E Partner", "PARTNER"],
  ]) {
    const hash = await bcrypt.hash(password, 12);
    const res = await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", name, role, status, "createdAt")
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now())
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [randomUUID(), email.toLowerCase(), hash, name, role],
    );
    console.log(
      res.rowCount === 1
        ? `seed-e2e: created ${role} ${email}`
        : `seed-e2e: ${email} already exists — nothing changed`,
    );
  }
} finally {
  await client.end();
}
