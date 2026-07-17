# ADR-012 — Auto-provisioning trigger: how the control plane runs the tenant scripts

**Status:** proposed 2026-07-18 (owner decision pending — this ADR frames the
options; no code ships until a mechanism is chosen)

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

## Recommendation (proposed)

**D + A, staged.** The app, on convert/provision, **opens a registry PR** via a
narrowly-scoped GitHub token (contents write on the deploy repo only) — honoring
invariant 1 and giving the founder-review checkpoint (invariant 3). Merging that
PR (`workflow_run`) then triggers a **`provision-tenant.yml`** Action that SSHes to
the box and runs the script, reusing `sync-to-box.yml`'s key — so the box-SSH
capability stays in CI, never in the public container (invariant 2). This is the
most defensible for a solo operator: every provision is a reviewable, revertable
PR; the app holds only a repo-scoped token; and it composes from patterns already
in the repo rather than a new privileged box listener.

For **staging/demo** tenants the registry PR may auto-merge (trusted, low-stakes);
**prod** provisioning keeps the human merge. Cross-box prod provisioning from the
staging control plane stays out of scope (per-box boundary) until a prod-box CI
leg exists.

If CI-in-the-loop latency proves unacceptable, fall back to **B** (box listener) —
it keeps the same privilege split without the git round-trip.

## Decide at implementation

- GitHub token scope + storage for the app (fine-grained, contents-write on the
  deploy repo only; box `.env`, never committed).
- Whether the registry PR carries the full computed entry (slug/db/domain/
  languages/modules/currency/template from the signup + module choices, ADR-010) —
  the app already reads the registry grammar (`lib/tenant-registry.ts`).
- Idempotency + status reflection: the script is idempotent; the control plane
  needs to surface provisioning state (the `Client.status='LIVE'` / registry
  `status` flip) back to `/admin`.
- Deprovision path (same trigger, `deprovision-tenant.sh`) — likely founder-only.
