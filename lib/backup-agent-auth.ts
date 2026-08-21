// WHICH BOX is on the other end of this bearer — not merely "a valid one".
//
// The three agent endpoints shipped with ONE shared `BACKUP_AGENT_SECRET` for the
// whole environment, and both boxes hold it. That is one credential for two
// principals, and it quietly undoes the rule the deploy repo states about its own
// SSH keys: *"Staging never gets a key to prod — no privilege-escalation path from
// the weaker box to the client box."* Through the control plane there was one. A
// compromise of the STAGING box (the weaker one, by that same document's words)
// yielded a bearer that could:
//
//   * push a whole-box inventory FOR PROD — and the push PRUNES what it stops
//     listing (ADR-014 D1), so it could erase the control plane's entire record of
//     the paying tenant's backups, making the page and the alarm both say the
//     opposite of the truth;
//   * claim prod's pending jobs (leasing them away from the real prod agent) and
//     post results for them.
//
// Neither destroys a backup — deletion is a per-box opt-in on the box itself — but
// both make the one surface that answers "is this restaurant's data safe?" lie.
//
// So the bearer now names a box: `BACKUP_AGENT_SECRET_<BOX>`. The BOX SIDE NEEDS NO
// CHANGE — each box already reads its own `.env`, so per-box secrets are just
// different values in the same variable there. Only the control plane has to learn
// more than one.
//
// Pure: the environment is a parameter, so every branch is unit-testable and no
// caller can accidentally authenticate against a variable it did not intend.

import { bearerAuthorized } from "@/lib/cron-auth";

/**
 * The legacy shared secret authenticates as **any** box.
 *
 * Kept deliberately for the rollout: shipping the strict form alone would mean the
 * code and both boxes' `.env` had to change in the same instant, and the failure
 * mode of getting that wrong is every box going silent — the exact state the alarm
 * reads as "unprotected". With this, the order is safe in any sequence, and the
 * fallback is removed in a follow-up once both per-box values are set and both
 * agents have been observed pushing.
 */
export const ANY_BOX = "*";

const PREFIX = "BACKUP_AGENT_SECRET_";

/** `prod` → `BACKUP_AGENT_SECRET_PROD`. The box vocabulary is `[a-z0-9-]`, and a
 *  hyphen is not legal in a shell variable name, so it becomes `_`. */
export function envNameForBox(box: string): string {
  return PREFIX + box.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

type Env = Record<string, string | undefined>;

/** Is ANY agent credential configured at all? Callers answer 503 for "no", which
 *  keeps "not configured" and "wrong token" distinguishable to an operator
 *  without being distinguishable to a caller. */
export function backupAgentConfigured(env: Env = process.env): boolean {
  if (env.BACKUP_AGENT_SECRET) return true;
  return Object.entries(env).some(([k, v]) => k.startsWith(PREFIX) && !!v);
}

/**
 * The box this request has proven it is, or null.
 *
 * Every configured per-box secret is compared — no early exit on the first match,
 * because two boxes sharing a value is an operator error that must not become an
 * identity that depends on `Object.keys` ordering. If more than one matches, the
 * request is refused: an ambiguous credential is not an identity.
 *
 * `ANY_BOX` means the legacy shared secret was presented (see above).
 */
export function authenticatedBox(request: Request, env: Env = process.env): string | null {
  const matches = Object.entries(env)
    .filter(([k, v]) => k.startsWith(PREFIX) && !!v && bearerAuthorized(request, v))
    .map(([k]) => k.slice(PREFIX.length).toLowerCase());
  if (matches.length > 1) return null;
  if (matches.length === 1) return matches[0];
  return bearerAuthorized(request, env.BACKUP_AGENT_SECRET) ? ANY_BOX : null;
}

/**
 * May the caller act as `claimed`?
 *
 * Box names are compared case-insensitively with `_` and `-` treated alike, so
 * `BACKUP_AGENT_SECRET_E2E_BOX` authenticates the box the registry calls
 * `e2e-box`. Nothing else is normalised: a box is whatever the registry and the
 * agent already agree it is called.
 */
export function boxAuthorized(authenticated: string | null, claimed: string): boolean {
  if (!authenticated) return false;
  if (authenticated === ANY_BOX) return true;
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  return norm(authenticated) === norm(claimed);
}
