// Craft-branded transactional email shells. Email clients don't load web
// fonts or external CSS, so the design system is translated to what survives
// everywhere: table layout, inline styles, the craft palette (cream paper,
// terracotta ink), Georgia for the "hand-set" headings and dashed borders
// standing in for the hand-drawn ones. All dynamic values must be escaped by
// the caller (lib/email.ts escapeHtml) BEFORE they reach these helpers.
import { escapeHtml } from "@/lib/email";

const C = {
  bg: "#FFF9F2", // cream paper
  card: "#FFFDF9",
  ink: "#2E2118",
  muted: "#8A7565",
  primary: "#A84B2F", // terracotta
  border: "#E5D3BD",
};

export function craftEmail(opts: {
  /** Small label above the title, e.g. "Partner program" */
  kicker?: string;
  title: string;
  /** Pre-escaped/trusted HTML for the body */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Muted line under the body, e.g. link expiry */
  footerNote?: string;
}): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="padding:0 8px 18px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:bold;color:${C.primary};">SofraPiwas</span>
          <span style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:${C.muted};">&nbsp;— a table laid for guests</span>
        </td></tr>
        <tr><td style="background:${C.card};border:2px dashed ${C.border};border-radius:14px;padding:32px 28px;">
          ${opts.kicker ? `<p style="margin:0 0 10px;font-family:Verdana,Geneva,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${C.primary};">${opts.kicker}</p>` : ""}
          <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:${C.ink};">${opts.title}</h1>
          <div style="font-family:Verdana,Geneva,sans-serif;font-size:14px;line-height:1.7;color:${C.ink};">
            ${opts.bodyHtml}
          </div>
          ${
            opts.cta
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr>
                   <td style="background:${C.primary};border-radius:12px;">
                     <a href="${opts.cta.url}" style="display:inline-block;padding:12px 26px;font-family:Verdana,Geneva,sans-serif;font-size:14px;font-weight:bold;color:#FFF9F2;text-decoration:none;">${opts.cta.label}</a>
                   </td>
                 </tr></table>`
              : ""
          }
          ${opts.footerNote ? `<p style="margin:18px 0 0;font-family:Verdana,Geneva,sans-serif;font-size:12px;color:${C.muted};">${opts.footerNote}</p>` : ""}
        </td></tr>
        <tr><td style="padding:18px 8px 0;font-family:Verdana,Geneva,sans-serif;font-size:11px;color:${C.muted};">
          SofraPiwas · restaurant software with a warm heart · <a href="https://sofrapiwas.com" style="color:${C.muted};">sofrapiwas.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Key/value rows for founder-inbox notifications. Values are escaped here. */
export function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0;width:100%;">
    ${rows
      .map(
        ([k, v]) => `<tr>
      <td style="padding:6px 14px 6px 0;font-family:Verdana,Geneva,sans-serif;font-size:13px;color:${C.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td>
      <td style="padding:6px 0;font-family:Verdana,Geneva,sans-serif;font-size:13px;color:${C.ink};">${escapeHtml(v)}</td>
    </tr>`,
      )
      .join("")}
  </table>`;
}
