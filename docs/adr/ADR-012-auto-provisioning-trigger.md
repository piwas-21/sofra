# ADR-012 — Auto-provisioning trigger: how the control plane runs the tenant scripts

**Status:** **accepted 2026-07-26** — **D + A** was chosen and shipped, and proven end
to end (merged registry PR → live HTTPS tenant in ~12 min); **amended 2026-07-30** — the
second half of the chain is now automatic: merging the registry PR builds the tenant
image and provisions. See §Amendment.

## Context

ADR-003 fixed provisioning as **scripts-first, control-plane-later** — *"the
control plane later calls the same scripts, no parallel mechanism."* Today the
scripts (`deploy/provision-tenant.sh`, `deprovision-tenant.sh`) are **founder-run
by hand over SSH** (`bash .ssh/staging.sh 'cd /opt/rumi/deploy && ./provision-tenant.sh <slug>'`).
Signup intake + conversion now exist (ADR-004; sofra #59–#63) and the direct-owner
flow (`payerUserId`) has landed, so the next step is closing the loop: a converted
signup should be able to **provision the tenant** without a manual SSH session.

The seam is deliberately **wide open** and must stay narrow:

- The `sofra` control-plane container runs on the **staging box**, public-facing
  behind Caddy. Its only box coupling is the registry bind-mount **`:ro`**
  (`TENANT_REGISTRY_PATH`). **No docker socket, no SSH key, no write access** to
  `deploy/`. (`grep` of `sofra/app|lib` for `child_process|ssh|exec|dispatch`
  returns nothing — verified 2026-07-18.)
- The scripts run **on the box as the `rumi` deploy user** (docker-group, no root).
  The SSH keys that can reach them live on the **founder's laptop** and in
  **GitHub Actions secrets** (`sync-to-box.yml`) — never in the app container.
- **Per-box boundary:** `provision-tenant.sh` refuses any tenant whose `box` ≠ the
  local `BOX_ROLE`. The staging-hosted control plane can therefore only provision
  **staging** tenants; provisioning a **prod** tenant needs the prod box's own
  docker-group access (prod holds the only cross-box key, never the reverse).

## Invariants any trigger must preserve

1. **Registry stays git-first** (ADR-007 / ADR-003): the `registry.yml` entry is
   committed → synced (`sync-to-box.yml`) → *then* the script runs. No trigger
   writes the registry from the app (the mount is `:ro` by design).
2. **The public app container stays unprivileged** — it must not gain a box SSH
   key or the docker socket. Any box-side execution privilege lives elsewhere
   (CI, or a dedicated box-side listener), reachable only via an authenticated,
   one-directional, validated call.
3. **A human review checkpoint before first live provisioning** (solo operator,
   real infra) — at minimum for prod; staging/demo may auto-run once trusted.

## Options

**A. Control-plane → GitHub `workflow_dispatch` → Action SSHes to the box.**
The app calls the GitHub API to dispatch a `provision-tenant.yml` workflow (new,
in the deploy repo) that reuses the exact `sync-to-box.yml` SSH pattern to run the
script. *Trade-off:* the app needs a GitHub token (new secret in the container)
scoped to dispatch; the box-SSH key stays in CI. Fast, reuses proven prior art,
but couples provisioning to a token the public app holds.

**B. Pull model — an authenticated box-side listener the app POSTs to.**
Mirrors `retention-cron.yml`'s `CRON_SECRET` bearer: a small box-side service
(systemd/cron with docker-group access) exposes an authenticated endpoint (or
polls a signed request); the app calls over loopback/HTTPS with a shared secret
and holds **no** execution privilege. *Trade-off:* introduces a new privileged
listener on the box to build + harden; keeps the app container itself clean.

**C. Queue / shared writable seam.**
The app writes a "provision request" (its own sofra DB row, or a file in a new
writable shared volume); a box-side worker polls and runs the script. *Trade-off:*
opens the **first writable seam** between the two trust zones — must be strictly
one-directional + validated. More moving parts than B for the same privilege split.

**D. Git-native — the app commits the registry entry via the GitHub API.**
The app opens a **PR** (or commits) the `registry.yml` entry to the deploy repo
via a contents-scoped GitHub token; `sync-to-*.yml` delivers it; a founder (or a
`workflow_run`-chained Action) then runs the script. *Trade-off:* slowest, but
preserves ADR-003/007 unchanged, is fully auditable/reversible (a reviewable PR),
and adds **no box privilege** to the app — only repo-contents write.

## Recommendation — chosen and shipped

**D + A, staged.** The app, on convert/provision, **opens a registry PR** via a
narrowly-scoped GitHub token (contents write on the deploy repo only) — honoring
invariant 1 and giving the founder-review checkpoint (invariant 3). Merging that
PR (`workflow_run`) then triggers a **`provision-tenant.yml`** Action that SSHes to
the box and runs the script, reusing `sync-to-box.yml`'s key — so the box-SSH
capability stays in CI, never in the public container (invariant 2). This is the
most defensible for a solo operator: every provision is a reviewable, revertable
PR; the app holds only a repo-scoped token; and it composes from patterns already
in the repo rather than a new privileged box listener.

Cross-box prod provisioning from the staging control plane stays out of scope (per-box
boundary) until a prod-box CI leg exists.

**Auto-merge was not taken**, and the 2026-07-30 amendment is why it is not needed:
automating the work *after* the merge gets the same hands-off result while keeping the one
thing worth a human, which is reading the proposed entry. Auto-merging is the *onboarding
plan's* option C (§2), explicitly rejected there — not to be confused with option C above.

If CI-in-the-loop latency proves unacceptable, fall back to **B** (box listener) —
it keeps the same privilege split without the git round-trip.

## Decided at implementation

- **Token scope + storage.** `PROVISION_GITHUB_TOKEN` — fine-grained, `piwas-21/restaurant-app-deploy`
  only, Contents + Pull requests: write. Lives in `/opt/rumi/deploy/.env` on the box,
  never committed. It can propose a tenant and nothing else. **Its expiry is silent**
  (`/admin/provision` degrades to a "not configured" banner rather than erroring), so
  the expiry is calendared — see the workspace runbook §0.
- **The PR carries the full computed entry** (`lib/provisioning-registry.ts`):
  slug-derived `db`/`db_role`/`compose_project`/`domain`/`frontend_tag`, plus
  languages/modules/currency/template from the signup, `status: provisioning`,
  `managed: scripts`, and `backend_tag: latest` — released code, always. It was
  derived from the *box* until 2026-07-31, which silently handed every self-serve
  tenant the develop build, since every one of them lands on `box: staging` because
  that is where the control plane runs. A develop-tracking showcase (`demo`) is a
  hand-edit at the merge checkpoint, which is the one place a human already reads
  the entry. Workspace `docs/plans/SOFRA-ONBOARDING-PLAN.md` §2b.
- **`modules` is what the entry may carry, not simply what was bought.** `online-payments`
  is emitted only alongside a `stripe_account:`, because `provision-tenant.sh` refuses that
  pair's lone half and does so *before* the database, the compose project and the image —
  so an entry with the module and no account yields no tenant at all, not a tenant lacking
  card payment. The founder supplies the account on `/admin/provision` (runbook §2b creates
  it first, so it is in hand), and the entry carries both in one shot. A self-serve buyer
  has none and cannot be given one — only the restaurant can create it, through Stripe's
  hosted onboarding — so their module is withheld, the PR body states what the second
  registry PR must add, and `deferred` is recorded on the provisioning audit entry.
- **Deprovision stays founder-only** over SSH. Unchanged.
- **Status reflection back to `/admin` is still open** — the registry `status` flip to
  `active` remains a manual follow-up commit, and nothing automatic reads it.

## Amendment — 2026-07-30: the merge chains build + provision

> **Mind the option letters.** A–D above are this document's, and what shipped is
> **D + A**. SOFRA-ONBOARDING-PLAN §2 re-uses A/B/C for a *different* question — how much
> of the post-merge work to automate — and this amendment implements that plan's **option
> B**. Same letters, different axis; the plan's B is not the box listener described above.

Shipped as the deploy repo's `provision-on-registry-merge.yml`: merging the registry PR
now chains `build-tenant-image.yml` (frontend repo) → `provision-tenant.sh` on the box.
The founder merges; nothing else is theirs to do.

**Why the invariants survive** — this is an amendment, not a violation:

| Invariant | Still holds because |
|---|---|
| 1. registry stays git-first | the chain only **reads** the registry, after the entry is committed, reviewed and synced. Nothing writes it. |
| 2. the public container stays unprivileged | unchanged. The box SSH key is still only in Actions secrets; `sofra` gained no capability. The chain's one new credential (`FRONTEND_DISPATCH_TOKEN`, Actions:write on the frontend repo) lives in the **deploy repo's** Actions secrets, not in the app. |
| 3. a human review checkpoint before first live provisioning | the checkpoint **is the merge**. This ADR's own recommendation already allowed for it: *"a founder (or a `workflow_run`-chained Action) then runs the script."* Its value was a human reading the proposed YAML; it was never improved by that human also copying two `gh workflow run` commands. |

What made this safe now and not at proposal time is **payment gating**
(`lib/provisioning-payment-gate.ts`, O2): a self-serve tenant gets no proposal at all
until its first payment settles. Without that, coupling an anonymous form to a merge
that provisions would put spam one rubber-stamp away from a database.

**Two properties the chain owes, and how it pays them:**

- **Idempotent.** Selection is on state, never on the push diff — a diff-based trigger
  cannot survive a revert-and-remerge, which reproduces the same diff. A slug is
  **eligible** when the registry declares intent (`managed: scripts` + `box: staging` +
  `status: provisioning`) and the chain has not already finished it. Eligible is not the
  same as provisioned: the run still refuses the whole batch over a cap (2), and refuses
  everything if `FRONTEND_DISPATCH_TOKEN` is missing — both reported, neither silent.

  The completion marker is one the chain writes itself
  (`/opt/rumi/tenants/<slug>/.chain-provisioned`), **not** the tenant's `.env`.
  `provision-tenant.sh` renders `.env` early and then keeps going through
  `docker compose pull`, `up -d` and a five-minute health wait, so `.env` means "the
  script started". Keying on it would make the most likely failure this chain introduces —
  provisioning against an image the build never published — permanently invisible: the
  retry the failure notice recommends would find `.env`, skip, and report green. A tenant
  with `.env` but no marker is therefore **completed**, not skipped.
  Consequence, deliberate: **first provisioning only.** Re-provisioning a live tenant
  (a module upsell) stays an explicit `provision-tenant.yml` dispatch, because an
  unattended trigger that also re-applied would let an unrelated registry edit restart
  every tenant on the box.
- **Failure-visible.** Nobody watches a terminal now, so every outcome is reported to
  where the founder already is: a comment on the registry PR they just merged, plus an
  issue on the deploy repo when anything fails. A silent automatic chain would be worse
  than a noisy manual one.

  Two cases are easy to leave silent and are deliberately not. The **upstream registry
  sync failing** is checked in a *step* rather than the job's `if:` — gating the job would
  skip the workflow entirely, so the `if: always()` reporter would never run, and a failed
  sync is exactly when the founder is wondering why their merge did nothing. And an entry
  the chain **refuses** (a `box: prod` tenant, a malformed field) is reported too, not just
  dropped: a merged tenant that will never be provisioned is the same silence in a
  different costume.

**Still founder-operated after this amendment:** credential handover. The generated
admin password is read off the box by hand. The one-time-reveal replacement (never
emailed, forced change at first login) is the remaining half of O3.

**Scope unchanged:** staging box only — the chain follows `sync-registry-to-staging.yml`
and inherits its narrowness. A `box: prod` entry is reported and never provisioned,
per the per-box boundary above.
