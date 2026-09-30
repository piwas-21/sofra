# ADR-015 — Printer credential custody and renewal

Status: accepted; owner requested SaaS admin token management.

## Decision

`/admin/printers` is admin-only. Sofra stores existing and pending **printer-only**
keys encrypted with AES-256-GCM, random IVs and tenant/purpose-bound AAD.
`PRINTER_CREDENTIAL_ENCRYPTION_KEY` is a separate 32-byte hexadecimal encryption
key. Back it up with the box configuration. Changing it without re-encryption
makes stored credentials unreadable; do not treat this as a routine env rotation.

This deliberately supersedes the old no-printer-secret-custody statement in the
deploy runbook. ADR-012's execution boundary remains: Sofra has no SSH key,
Docker socket, box filesystem access, or Actions write token. The host agent
initiates HTTPS requests, authenticated by a dedicated per-box
`PRINTER_AGENT_SECRET_<BOX>`. Backup credentials cannot call printer sync.

The registry remains read-only. Each sync checks the authenticated box against
both the claimed box and every active printing tenant. Admin actions validate
registry eligibility and require a fresh report from the tenant's current box.
Legacy tenants can report tokens but renew only when their local agent opts in.

## Lifecycle

The agent reports the configured key only after probing the actual printer-feed
endpoint. An absent key can be generated once a recent report exists. An admin
requests renewal by typing the tenant slug; concurrent requests use an atomic
conditional update so only one replacement can be queued.

Until installation is verified the dashboard withholds the replacement.
The host changes only `PrinterSettings.ApiKey`, recreates only that backend
(without pulling an image), and checks new-key success and old-key rejection.
Failure restores the old key and remains pending for retry. An acknowledged
replacement clears pending state. Lost acknowledgements retry idempotently.
The dashboard polls pending state and displays verification failures or stale
reports; a failed or old report cannot authorize a reveal.

All printer apps for a tenant share its key. Renewal briefly restarts the backend
and requires updating every device; there is no automatic expiry or per-device
revocation. App wire protocol remains `X-Api-Key` with the existing settings.

## Secret handling

Initial HTML/RSC includes metadata only. Reveal is a separately guarded server
action and requires a durable audit entry. Renewal and successful installation
also have audit entries, without key material. The browser masks after one minute
or when hidden; copy includes URL, slug and key for private handover. No email is
sent. Action errors and agent logs never serialize credentials or remote bodies.

## Rollout

Apply `20261001090000_printer_credentials` before rolling the app. Configure the
encryption key and per-box agent secrets in the control-plane service. Install
`printer-agent.sh`, `printer-agent.py`, `printer_agent_storage.py` on each box;
configure `PRINTER_AGENT_URL`, `PRINTER_AGENT_SECRET`, and a one-minute host cron.
The agent requires Python 3, PyYAML, Docker Compose and flock. Staging uses its
own encryption key and bearer; test with `PRINTER_AGENT_TENANTS=demo`. No production
token is renewed by deployment. See the deploy printer-access runbook.
