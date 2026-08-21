// The mail the backup page could not send.
//
// Founder-only and English, like every other founder notice (M5/M8): it names
// tenant slugs and boxes, it is operational rather than commercial, and no
// customer ever receives it. Kept apart from the sweep for the reason
// `go-live-email.ts` is — the flow should read as a flow, not as a template
// interleaved with one.
//
// WHAT IT MAY NOT DO: quote a number it did not derive. Every age below comes
// from an artifact we actually hold (ADR-014 D4's honesty rule), and a tenant
// under a quiet box is reported as UNKNOWN rather than as protected, because the
// last thing we heard is not the same as the current state.

import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import type { BackupHealth } from "@/lib/backup-health";
import type { BackupAlert, BackupConcern } from "@/lib/backup-alert-policy";

/** "RUMI Restaurant (rumi)" — the slug is always present because the slug is what
 *  a box, a registry entry and a restic path all agree on. */
function label(c: BackupConcern): string {
  return c.name ? `${c.name} (${c.slug})` : c.slug;
}

/** How a verdict reads in a subject-line-adjacent sentence. `unprotected` is the
 *  only one shouted: it is the state where copies are aging out of existence. */
const STATE_WORD: Record<BackupHealth, string> = {
  never: "never backed up",
  unprotected: "UNPROTECTED",
  stale: "stale",
  protected: "ok",
};

/** Hours, until hours stop being readable. */
function age(hours: number): string {
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)} days`;
}

/** One line, in the order someone triaging needs it: the verdict, then the
 *  evidence, then the qualifiers that change what the evidence means. */
function verdict(c: BackupConcern): string {
  const parts: string[] = [];
  if (c.health === "never") parts.push("no backup has ever been reported");
  else if (c.ageHours !== null) {
    parts.push(`${STATE_WORD[c.health]} — newest copy ${age(c.ageHours)} old`);
  }
  if (c.singleSiteOnly) parts.push("every copy is on the box itself");
  if (c.boxQuiet) parts.push("box is quiet, so this age is a memory");
  if (c.box) parts.push(`box: ${c.box}`);
  return parts.join(" · ");
}

function subjectFor(alert: BackupAlert): string {
  const n = alert.concerns.length;
  if (alert.noBoxHasEverReported) return "SofraPiwas — Backups: no box has ever reported";
  if (alert.quietBoxes.length > 0 && n === 0) {
    return `SofraPiwas — Backups: ${alert.quietBoxes.join(", ")} has gone quiet`;
  }
  const lead = alert.concerns[0] ? label(alert.concerns[0]) : "a box";
  const more = n > 1 ? ` (+${n - 1} more)` : "";
  return alert.level === "critical"
    ? `SofraPiwas — Backup alert: ${lead}${more}`
    : `SofraPiwas — Backups need a look: ${lead}${more}`;
}

/**
 * "These restaurants are not protected right now."
 *
 * Sent when the situation is new, has CHANGED, or has stayed bad long enough to
 * be worth repeating — never on every sweep. `reason` rides along in the footer
 * so a repeat is visibly a repeat, which is what stops the reader from treating
 * the fourth copy as a fourth incident.
 */
export async function sendBackupAlertEmail(opts: {
  to: string;
  alert: BackupAlert;
  reason: "new" | "changed" | "reminder";
}): Promise<{ sent: boolean }> {
  const { alert } = opts;
  const rows: [string, string][] = alert.concerns.map((c) => [label(c), verdict(c)]);
  for (const box of alert.quietBoxes) {
    rows.push([`Box ${box}`, "no inventory pushed for over 6h — its tenants are UNKNOWN, not protected"]);
  }

  const lead = alert.noBoxHasEverReported
    ? "No box has ever pushed a backup inventory. Either the box-side agent is not deployed, or it cannot reach this container — until one reports, nothing on the platform is known to be backed up."
    : `${alert.concerns.length} of ${alert.watched} tenants that should be dumped nightly are not in a protected state.`;

  const neverNote = alert.concerns.some((c) => c.health === "never")
    ? "<p style=\"margin:0 0 12px;\">A tenant listed as <em>never</em> that went live in the last day may simply be waiting for its first nightly (02:15). One that has been live longer was never wired into the backup at all — a provisioning gap, which survives every green nightly run.</p>"
    : "";

  return sendEmail({
    to: opts.to,
    subject: subjectFor(alert),
    html: craftEmail({
      kicker: "Backups",
      title: alert.level === "critical" ? "A restaurant's data is not protected" : "Backups need a look",
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(lead)}</p>
${detailRows(rows)}
${neverNote}
<p style="margin:12px 0 0;">Thresholds: over 36h since the newest copy is stale, over 72h is unprotected, and a box that has not pushed an inventory in 6h is quiet.</p>`,
      cta: { label: "Open /admin/backups", url: `${siteUrl()}/admin/backups` },
      footerNote:
        opts.reason === "reminder"
          ? "You have had this one before — it is unchanged and still true."
          : "You will get this again only if it changes, or stays true (24h for red, 72h for amber).",
    }),
  });
}

/**
 * "All clear" — sent ONCE, when the last thing said was a problem and it is over.
 *
 * The cheapest half of the feature and the one that makes the rest readable: an
 * alarm with no end is an alarm that gets filtered.
 */
export async function sendBackupClearedEmail(opts: {
  to: string;
  watched: number;
}): Promise<{ sent: boolean }> {
  return sendEmail({
    to: opts.to,
    subject: "SofraPiwas — Backups: all clear",
    html: craftEmail({
      kicker: "Backups",
      title: "Every restaurant is protected again",
      bodyHtml: `<p style="margin:0 0 12px;">All ${opts.watched} tenants that are dumped nightly have a recent copy, and every box is reporting.</p>
<p style="margin:0;">Nothing further will be sent until something changes.</p>`,
      cta: { label: "Open /admin/backups", url: `${siteUrl()}/admin/backups` },
    }),
  });
}
