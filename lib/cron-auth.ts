// Shared bearer guard for the machine-to-machine cron endpoints.
//
// Extracted when a second cron route (/api/cron/go-live) copied this verbatim from
// the first (/api/cron/retention). Two identical constant-time comparisons is the
// kind of duplication that ages badly: a fix to one — a length guard, a header
// name, a timing property — silently does not reach the other, and this is an
// AUTH check, so the copy that lags is a security hole rather than a style nit.

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer check against CRON_SECRET.
 *
 * Both sides are SHA-256'd to a fixed 32 bytes first so `timingSafeEqual` never
 * sees a length mismatch — which would throw, and would also leak the secret's
 * length via timing.
 *
 * Returns false when CRON_SECRET is unset: no secret, no access. Callers answer
 * 503 for that case separately, so "not configured" and "wrong token" stay
 * distinguishable to an operator without being distinguishable to a caller.
 */
export function cronAuthorized(request: Request): boolean {
  return bearerAuthorized(request, process.env.CRON_SECRET);
}

/**
 * The same constant-time bearer check against an ARBITRARY shared secret.
 *
 * Extracted when a third machine-to-machine posture (the backup agent's three
 * endpoints, BACKUP_AGENT_SECRET) needed it and /api/telemetry/fleet had already
 * copied the comparison a second time. This file's own header says why that
 * matters: a fix to one copy — a length guard, a header name, a timing property
 * — silently does not reach the others, and these are AUTH checks, so the copy
 * that lags is a hole rather than a style nit.
 *
 * Callers pass the secret rather than a name, so nothing here can read an
 * environment variable a caller did not intend. An unset/empty secret returns
 * false: no secret, no access. Callers answer 503 for that case separately, so
 * "not configured" and "wrong token" stay distinguishable to an operator without
 * being distinguishable to a caller.
 */
export function bearerAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const provided = digest(request.headers.get("authorization") ?? "");
  const expected = digest(`Bearer ${secret}`);
  return timingSafeEqual(provided, expected);
}
