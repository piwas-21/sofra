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

// The shared `BACKUP_AGENT_SECRET` fallback is GONE (2026-08-21), on schedule and
// on evidence: it existed only so the code and both boxes' `.env` did not have to
// change in the same instant, and it was removed the moment both agents had been
// observed pushing with their own bearer (`BackupInventory.receivedAt` moving for
// `prod` and `staging`, and a cross-box call refused 403 from both directions,
// measured against production). While it existed, the old value — the one BOTH
// boxes held — still authenticated as any box, so leaving it in place would have
// left the whole hole open behind a closed door.

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
 * A box whose secret this control plane does not hold gets `null` — 401 — and then
 * goes quiet, which the backup alarm reports (D5). That is the intended failure
 * mode for a new box nobody configured: loud, and in the surface built to be loud.
 */
export function authenticatedBox(request: Request, env: Env = process.env): string | null {
  const matches = Object.entries(env)
    .filter(([k, v]) => k.startsWith(PREFIX) && !!v && bearerAuthorized(request, v))
    .map(([k]) => k.slice(PREFIX.length).toLowerCase());
  return matches.length === 1 ? matches[0] : null;
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
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  return norm(authenticated) === norm(claimed);
}
