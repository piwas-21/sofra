# ADR-014 — Tenant backup visibility and the box-pulled job queue

**Status:** **accepted 2026-08-21** — shipped as `/admin/backups` plus three
bearer-authed machine endpoints. Amends nothing; depends on ADR-012 (invariant 2)
and ADR-007 (the registry is a read-only seam).

## Context

Backups already exist and are healthy. Measured on both boxes on 2026-08-20: each
dumps nightly at **02:15**, prod ships cross-box at **03:00** into two
restic-encrypted repositories, and `restic -r /opt/rumi/backups/restic-staging
snapshots` returns 11 snapshots, newest 2026-08-20 03:00, 18 MiB.

What did not exist was any way to **see** that from outside an SSH session — and
therefore any way to notice a tenant that had fallen out of it. The owner asked
for two things, and they are not the same thing:

1. Trial tenants' data should survive them going quiet, "in case they want to come
   back later on".
2. He should be able to see and manage tenant backups from the sofra admin.

(1) is largely already true. (2) did not exist at all. **So this ADR is not about
building backups; it is about the owner's window onto them, and the control
surface.**

## Decision

### D1 — Every credential points BOX → SOFRA. The box PULLS its work.

The control plane never holds a credential that can reach a box. This is ADR-012
invariant 2 (a compromised public sofra container may *propose* a tenant but never
*provision* one), and it decides the whole shape of this feature.

Rejected alternative, and the reason it is rejected: give sofra a GitHub token
with `Actions: write` and dispatch a `backup-tenant.yml` workflow. It would work,
it reuses proven prior art, and it is exactly how ADR-012's chosen option gets
provisioning done — but **`Actions: write` cannot be narrowed to a single
workflow** (documented in workspace `docs/runbooks/signup-to-live-tenant.md` §0b).
A token that can dispatch `backup-tenant.yml` can also dispatch
`deprovision-tenant.yml --drop-db`. **A backup feature must not ship a
tenant-destruction primitive as a side effect of being able to take a backup.**

Therefore: the box **PUSHES** its inventory and **PULLS** its jobs, over three
endpoints sharing one bearer secret (`BACKUP_AGENT_SECRET`), the same posture as
`PRINTER_TELEMETRY_SECRET` and `CRON_SECRET`:

    POST /api/telemetry/backups            whole-box inventory, idempotent upsert
    GET  /api/backups/jobs?box=<id>        pending jobs, leased on hand-out
    POST /api/backups/jobs/<id>/result     completion

Latency is one poll (~5 minutes) and that is accepted: a backup is not
interactive, and nothing on this page is an action where five minutes matters.

### D1a — One credential per BOX, not per environment.

The three endpoints shipped with ONE shared `BACKUP_AGENT_SECRET`, held by both
boxes. That is one credential for two principals, and it quietly undid the rule
`DEPLOYMENT.md` states about its own SSH keys — *"Staging never gets a key to prod
— no privilege-escalation path from the weaker box to the client box"* — because
through the control plane there was one. A compromise of the staging box yielded a
bearer that could **push an inventory FOR PROD**, and the push **PRUNES what it
stops listing** (D1), so it could erase the control plane's entire record of the
paying tenant's backups; it could also **lease away prod's jobs** and answer for
them. Neither destroys a backup — deletion is a per-box opt-in on the box itself —
but both make the one surface that answers *"is this restaurant's data safe?"* lie,
including the alarm added in D5.

So the bearer names a box: **`BACKUP_AGENT_SECRET_<BOX>`** (uppercased, `-` → `_`),
and every endpoint checks that the box the caller claims — in the body, in the
query, or on the job row — is the box it authenticated as. A mismatch is **403**
("the credential is real, it is simply not yours") except on a job result, which
answers **404**: a box that does not own a job may not learn that it exists.

**The box side needs no change at all.** Each box already reads its own `.env`, so
per-box secrets are simply different values under the same name there; only the
control plane learns more than one.

The legacy shared secret was accepted for exactly as long as the rollout needed —
shipping the strict form alone would have required the code and both boxes' `.env`
to change in the same instant, and the failure mode of getting that wrong is every
box going silent, which D5 reads as unprotected. It was **retired the same day**
(2026-08-21), on evidence rather than on a date: both agents observed pushing with
their own bearer, and a cross-box call refused **403 from both directions** against
production. Leaving it would have kept the whole hole open behind a closed door,
because the retired value is the one value BOTH boxes hold.

A box whose per-box secret this control plane does not hold gets **401**, and then
goes **quiet** — which D5 reports. That is the intended failure mode for a new box
nobody configured: loud, in the surface built to be loud.

An **ambiguous** credential (two boxes configured with the same value) authenticates
as nothing: picking one would make an identity depend on object key order.

### D2 — The page's product is the tenant that is NOT there.

A backup page that lists successes is how people find out too late. `/admin/backups`
therefore joins the DB inventory against the tenant registry in **both**
directions, and sorts worst-first:

- a **registry tenant with no artifact** is rendered rather than absent — that is
  a provisioning gap, which survives every green nightly run;
- an **artifact with no registry entry** is rendered too — that is a departed
  customer whose data we still hold, which is (1) above.

Thresholds, justified in `lib/backup-health.ts` next to the constants:

| Verdict | Rule | Why that number |
|---|---|---|
| `stale` | newest artifact > **36h** | one nightly cycle + 12h grace. Below ~24h+ a *healthy* tenant reads amber for part of every day, which trains the reader to ignore the colour. 36h cannot be reached without a run having been missed. |
| `unprotected` | newest artifact > **72h** | three consecutive nightlies missed — a schedule that is broken, not a blip. Two tiers exist so "look at this today" is distinguishable from "look at this now". |
| `never` | zero artifacts | outranks `unprotected`: aged-out means the schedule broke, zero usually means the tenant was never wired in. |
| box `quiet` | no inventory for > **6h** | six missed hourly pushes; beyond a reboot or deploy window. A quiet box makes its tenants **unknown**, not protected — every age below it becomes a memory rather than an observation, and the page says so. |
| `single-site` | every copy is `local` | fresh, green by every age rule, and gone with the box. A different kind of unprotected, so a different line. |

### D3 — `create` ships; `delete` ships **disabled**, and retention does the deleting.

`create` is safe — the worst case is a duplicate copy. `delete` destroys the only
copy of a departed customer's data with no undo anywhere in the system. Four
things decided it (the argument is repeated in `lib/backup-job-policy.ts`, where
the code is):

1. **A backup exists to survive mistakes, including ours.** A delete button in the
   control plane converts every other class of bug in this app — a stolen session,
   a mis-wired form, a 2 a.m. click on the wrong row — into permanent customer data
   loss. Strictly larger blast radius than the problem it solves.
2. **Retention already deletes, and deletes better.** `restic forget --prune` runs
   on the box under a policy committed in the deploy repo: declarative, reviewable
   in a PR, uniform, and impossible to fire by accident.
3. **We cannot verify it.** Sofra cannot inspect a box (D1). After a delete, all we
   can record is that the box *said* it deleted something. An unverifiable
   destructive primitive in the least-trusted component is the same class of
   mistake as giving that component `Actions: write`.
4. **It does not serve the stated need.** The ask was to KEEP a trial tenant's data.

So the wire contract keeps `delete` (the box agent is built against it, and a
contract is not changed unilaterally), the path is implemented and tested, and it
is **off unless `BACKUP_DELETE_ENABLED=true`** — a box `.env` edit plus a restart.
Destroying a customer's last copy should take a deployment, not a click. Even
switched on it requires the slug **typed**, a written **reason** (audited
verbatim), and an explicit **override** for a tenant's last artifact.

### D4 — The retention sentence is a DISPLAY of the box's policy, not the policy.

For a tenant whose trial has lapsed, whose registry entry is retired, or which has
no entry at all, the page states: *kept because <reason> — we still have their
data until <date>, N days from now*. The date is `newest artifact + N days`
(`BACKUP_RETENTION_DAYS`, default **180**).

180 days is chosen against two pressures: long enough for a seasonal closure and a
"we'll think about it over the winter" return — the owner's actual case, where 30
or 90 would answer *no* to exactly the customer we wanted back — and short enough
to remain a defensible answer to GDPR storage limitation (Art. 5(1)(e)): a stated,
finite window with a business reason rather than indefinite retention by default,
which is what "we just never delete backups" actually is.

The control plane does **not** enforce it — the box's `restic forget` does, and
this container cannot see the box. Hence: it is an env var meant to be set to the
same value in both places; if they disagree the box wins and this page is wrong;
and every date shown is derived from an artifact we actually hold, so the worst
case is under-promising about a copy the box still has. A tenant we hold **zero**
artifacts for is told "there is nothing to restore" — never given a window.

### D5 — The page shouts; a twice-daily sweep is what reaches a human.

D2 says the product is the tenant that is NOT there. That was half-built: a page is
only opened by someone who already suspects, and the tenant that has silently
fallen out of the nightly is exactly the one nobody thinks to look for. So the same
verdicts are swept twice a day (`POST /api/cron/backup-alerts`, CRON_SECRET bearer,
`.github/workflows/backup-alert-cron.yml`) and mailed to the founder inbox.

Four decisions carry it, and all four are about an alarm that stays worth reading:

1. **It alerts only where a nightly is EXPECTED.** A registry entry that is
   `retired`, `deprovisioned`, `archived` or still `provisioning` is skipped — a
   departed tenant's copies are an archive by design (D4) and are permanently,
   unfixably `unprotected` to an age rule. Alerting on them would produce a red
   mail nobody can ever act on, which is how an alarm gets muted. An **unknown**
   status is watched, not skipped: a registry typo must make this noisier, never
   quieter.
2. **It is keyed on a SIGNATURE of what is wrong, not on the run.** The marker is
   an audit row (`backup.alert.raised` / `.cleared` on `Platform/backups`) carrying
   a readable signature — `critical|rumi:unprotected|quiet:prod`. The same news is
   not re-sent; a *changed* situation is; an unchanged one is repeated at most
   daily while red and every three days while amber. Ages are deliberately absent
   from the signature, or every run would look like news.
3. **It closes its own loop.** One all-clear when everything recovers, then
   silence. An alarm you never hear the end of is one that gets filtered.
4. **An unreadable registry STOPS it.** The page degrades instead of blanking,
   which is right for a page. For the alarm it would be catastrophic: with no
   registry no tenant is "expected" any more, the concern list empties, and it
   would mail a cheerful all-clear at the moment it went blind. So a registry
   fault — like a missing recipient or a send that failed — sends nothing, writes
   no marker, and is reported as `skipped`, **on which the workflow fails its
   run**. That red Action is the alarm for the alarm.

A failed send writes **no** marker, the opposite of the trial-warning sweep
(re-mailing a *partner* is the worse mistake; here the recipient is the founder and
the subject is data loss, so a retry beats a silence).

**What the first production run corrected (2026-08-21).** The sweep was dispatched
by hand the moment it was live and mailed `critical, 3 concerns of 3 watched`. Both
halves of that were the alarm being wrong, and in the exact way rule 1 exists to
prevent — a red mail nobody can act on:

- **`rumi: never`.** The deploy repo's `bk_registry_tenants` **skips
  `managed: legacy`** when taking per-tenant dumps: tenant 1's database rides the
  whole-cluster dump instead (ADR-006), so a per-tenant artifact for it will never
  exist. `expectsNightly` now skips `managed: legacy` as well as the four statuses
  — silence about the per-tenant *view*, not about the tenant.
- **`single-site only` on both staging tenants.** The box agent **cannot report an
  off-box copy at all**: `bk_inventory_json` walks the box filesystem and hard-codes
  `location: "local"`, while `backup-offsite.sh` ships the whole dump directory into
  restic — so the flag is permanently true for every tenant while those copies
  demonstrably do exist off-box. It is a reporting gap, not a protection state, and
  it is no longer an alert trigger. The **page still shows it**, beside the artifact
  list where it can be read for what it is; re-arm the alert the day the agent
  enumerates restic snapshots.

Both were structural — they would have fired every day forever. The run cost
nothing and is the argument for dispatching a new alarm by hand rather than waiting
for its first schedule.

**D5a — and then the PAGE had to be told the same two things (2026-08-21, later).**
Correcting the alarm alone left the two surfaces disagreeing about one fact: the
sweep mailed `healthy` while `/admin/backups` went on rendering `rumi` as a red
`NEVER BACKED UP` in its headline count, and stamped *"every copy sits on the box
that runs this tenant"* on every tenant it listed. A page that contradicts its own
alarm does not make the reader cautious, it makes him pick one — and the red one is
the one that teaches him to stop reading colours. So:

- **`isClusterDumpOnly` moved into `backup-health.ts`** and is now imported by BOTH
  the alarm's `expectsNightly` and the page's row builder. Not deduplication for
  its own sake: the defect was never inside either module, each was self-consistent,
  and the only durable fix is that there is one rule to be consistent with. A unit
  test asserts the two agree, so a future edit that re-forks the rule fails.
- A cluster-dump-only row now reads **"Covered by the cluster dump"** in muted
  type, with a sentence saying what covers it, is **excluded from the headline
  count** (the same exclusion the sweep already makes), **sorts as calm** rather
  than into the alarm slot at the top, and **offers no "Back up now"** —
  `backup-tenant.sh` refuses anything that is not `managed: scripts`, so that
  button could only ever queue a job that comes back FAILED.
- The single-site line stays, moves **under the artifact list** where it reads as a
  caveat about that list, loses its `role="alert"` and its red, and now says what
  is actually known: *the agent reports only what it finds on the box, so off-box
  copies are missing from this list.* Re-arm it as an alert — as red, as a
  protection state — the day the agent enumerates restic snapshots and the signal
  becomes true (follow-up B-b).

The general lesson, and the reason this is written down rather than fixed quietly:
**when an alarm learns something, the page it was derived from has not.** Sharing
the query (`backup-overview-load.ts`) was never enough; the JUDGEMENT has to be
shared too, or the two drift the first time one of them is corrected.

### D6 — Restore is NOT a button here, and that is the same decision as D1.

The obvious next feature after "see the backups" is "press restore". It is not built,
and the reason is not effort: a restore writes into a tenant's live database on a box,
and **the control plane holds no credential that can reach a box** (D1, ADR-012
invariant 2). Building it would mean either giving sofra that credential — the one
thing this whole design exists to avoid — or routing it through the job queue, which
would put *"overwrite this restaurant's live database"* on the same rail as *"take a
backup"*, reachable from the public internet-facing container. The `delete` job is
already shipped **disabled** for a weaker version of that argument (D3); an overwrite
is strictly worse, because there is no second copy of what it replaces.

So restore stays an on-box, deliberate act — `deploy/restore-tenant.sh`, which
**rehearses into a throwaway database by default** and needs `--into <db> --force` to
touch anything real, and whose weekly unmocked run (`backup-rehearsal.yml`) is what
turns "we have a backup" from a hope into a measurement. What the control plane owes
this flow is the ANSWER to *"do we still have their data, and until when?"* (D4) — and,
since D5, the alarm when we would not. The founder then opens a terminal, on purpose.

## Privacy (D7)

An inventory is **metadata, never contents**. No dump's contents enter this
database and no surface renders them. What is stored — slug, size, timestamp,
snapshot ref, checksum — is nonetheless customer-identifying in aggregate (which
restaurants exist, how large each is, which have left), so:

- every human-facing view is behind `requireAdmin()`;
- the ingest is bearer-authed, and an unauthenticated one would be an information
  leak about the whole book of business, answered by a curl;
- the ingest response carries **counts only** — never a path, a ref or a slug;
- job requesters are logged by **name**, never email (CLAUDE.md §5.8).

The workspace privacy pack (`docs/privacy/pii-inventory.md`) should gain a row for
`BackupArtifact` / `BackupJob` in its next pass; nothing here is a new *category*
of personal data, but it is a new *location*.

## Consequences

- Sofra gains three machine endpoints and one admin page, and **no new privilege**.
  It still cannot reach a box.
- The box-side agent (deploy repo) owns everything that actually touches data.
- `BackupArtifact` is keyed on the registry slug and deliberately **not** a foreign
  key: artifacts are kept for tenants with no registry entry, which is precisely
  the departed customer this feature exists for. A FK would delete them.
- If a box agent is never deployed, the page says so loudly (no box has ever
  reported) rather than rendering an empty, reassuring list — and since D5 the
  sweep mails that exact sentence, because "no box has ever reported" and "no
  backups yet" look identical from the outside.
- The page and the sweep read the database through ONE loader
  (`lib/backup-overview-load.ts`). Two copies of that query would eventually
  disagree, and the failure is silent: the page red, the mail green.
- Alerting adds no privilege and no new credential. It reads what is already
  stored and writes an audit row; the box is still the only side that can reach
  data.
