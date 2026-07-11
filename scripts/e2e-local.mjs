// Local end-to-end test of the partner program against a running server.
// Drives server actions through their progressive-enhancement form POSTs
// (multipart + $ACTION_ID) — no browser needed. NOT part of the image.
//   node scripts/e2e-local.mjs http://localhost:3789 admin@example.com 'AdminPass…' partner@example.com
const [base, adminEmail, adminPassword, partnerEmail] = process.argv.slice(2);
if (!base || !adminEmail || !adminPassword || !partnerEmail) {
  console.error("usage: node scripts/e2e-local.mjs <base> <adminEmail> <adminPassword> <partnerEmail>");
  process.exit(2);
}

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function req(jar, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), cookie: jar.header() },
  });
  jar.absorb(res);
  return res;
}

async function follow(jar, res, limit = 5) {
  while ([301, 302, 303, 307, 308].includes(res.status) && limit-- > 0) {
    const loc = new URL(res.headers.get("location"), base);
    res = await req(jar, loc.pathname + loc.search);
  }
  return res;
}

async function login(jar, email, password) {
  const csrfRes = await req(jar, "/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, email, password });
  const res = await req(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return res.status;
}

const unescapeHtml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Find a progressive-enhancement form containing `marker`; return its hidden
 *  fields (incl. $ACTION_*) so we can replay the POST like a no-JS browser.
 *  Values must be HTML-entity-decoded — React serializes the action ref as
 *  JSON in the value attribute. */
function formFields(html, marker) {
  for (const m of html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)) {
    if (!m[1].includes(marker)) continue;
    const fields = {};
    for (const inp of m[1].matchAll(/<input([^>]*)>/g)) {
      const name = /name="([^"]*)"/.exec(inp[1])?.[1];
      const value = /value="([^"]*)"/.exec(inp[1])?.[1] ?? "";
      if (name) fields[unescapeHtml(name)] = unescapeHtml(value);
    }
    return fields;
  }
  return null;
}

async function postAction(jar, path, fields, extra = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...fields, ...extra })) fd.set(k, v);
  const res = await req(jar, path, { method: "POST", body: fd });
  return follow(jar, res);
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

// ---------- 1. Public apply ----------
const applicantEmail = partnerEmail;
let res = await fetch(`${base}/api/partner/apply`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "E2E Partner",
    email: applicantEmail,
    company: "E2E Agency",
    city: "Geneva",
    message: "I know three restaurants in Eaux-Vives that need this.",
    locale: "en",
  }),
});
ok("apply returns 200", res.status === 200);

res = await fetch(`${base}/api/partner/apply`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Bot", email: "bot@x.y", message: "spam", company_website: "http://spam" }),
});
ok("honeypot still 200 (fake ok)", res.status === 200);

// ---------- 2. Admin login + queue ----------
const admin = new Jar();
await login(admin, adminEmail, "definitely-wrong-password");
let page = await follow(admin, await req(admin, "/admin"));
ok("wrong password -> /admin redirects to login", page.url?.includes("/login") || page.status === 200 && (await page.text()).includes("Partner sign in"));

const admin2 = new Jar();
await login(admin2, adminEmail, adminPassword);
page = await req(admin2, "/admin");
let html = await page.text();
ok("admin sees queue", page.status === 200 && html.includes("E2E Partner"));

// partner-role isolation: admin pages later; first approve.
const approveFields = formFields(html, "Approve");
ok("approve form found", Boolean(approveFields));

page = await postAction(admin2, "/admin", approveFields);
html = await page.text();
const inviteLink = decode(/https?:\/\/[^<\s"]*\/invite\/[A-Za-z0-9_-]+/.exec(html)?.[0] ?? "");
ok("approve returns invite link", Boolean(inviteLink), inviteLink ? "link captured" : "not found in response");

// ---------- 3. Invite -> set password ----------
if (!inviteLink) {
  console.log("\nE2E: aborting — no invite link, later steps depend on it");
  process.exit(1);
}
const partner = new Jar();
const invitePath = new URL(inviteLink).pathname;
page = await req(partner, invitePath);
html = await page.text();
ok("invite page valid", page.status === 200 && html.includes("Set password"));

const pwFields = formFields(html, "purpose");
const partnerPassword = "e2e-Partner-Pass-42";
page = await postAction(partner, invitePath, pwFields, { password: partnerPassword, confirm: partnerPassword });
html = await page.text();
ok("set-password lands on login", html.includes("Partner sign in"));

page = await req(partner, invitePath);
ok("invite token single-use", (await page.text()).includes("invalid or has expired"));

// ---------- 4. Partner login + client pipeline ----------
const pjar = new Jar();
await login(pjar, applicantEmail, partnerPassword);
page = await req(pjar, "/dashboard");
html = await page.text();
ok("partner dashboard renders", page.status === 200 && html.includes("Your clients"));

// Partner-role isolation: /admin must redirect a partner away to /dashboard.
// (Don't string-match the body — the control layout ships the whole control.*
// i18n catalogue, incl. admin labels like "Partner applications", to every
// control page's client payload, so absence-of-string is a false signal.)
const adminProbe = await req(pjar, "/admin");
ok(
  "partner blocked from /admin",
  [301, 302, 303, 307, 308].includes(adminProbe.status) &&
    (adminProbe.headers.get("location") ?? "").includes("/dashboard"),
  `${adminProbe.status} -> ${adminProbe.headers.get("location") ?? "(none)"}`,
);
page = await follow(pjar, adminProbe);
html = await page.text();

// create client
let fields = formFields(html, "") // placeholder, refetch dashboard
page = await req(pjar, "/dashboard");
html = await page.text();
fields = formFields(html, "restaurantName");
page = await postAction(pjar, "/dashboard", fields, {
  restaurantName: "Café E2E",
  contactName: "Ada",
  email: "ada@cafe-e2e.ch",
  phone: "+41 22 000 00 00",
  city: "Geneva",
});
html = await page.text();
const clientPath = /\/dashboard\/clients\/[a-z0-9]+/.exec(html)?.[0] ??
  /href="(\/dashboard\/clients\/[^"]+)"/.exec(await (await req(pjar, "/dashboard")).text())?.[1];
ok("client created", Boolean(clientPath), clientPath ?? "");

// status -> AGREED
page = await req(pjar, clientPath);
html = await page.text();
fields = formFields(html, 'name="status"');
page = await postAction(pjar, clientPath, fields, { status: "AGREED" });
html = await page.text();
ok("status set to AGREED", html.includes("Agreed"));

// note
fields = formFields(html, 'name="body"') ?? formFields(html, "Add a note");
page = await postAction(pjar, clientPath, fields, { body: "Spoke with Ada — wants demo Tuesday." });
html = await page.text();
ok("note added", html.includes("Spoke with Ada"));

// request onboarding
fields = formFields(html, "Request onboarding");
page = await postAction(pjar, clientPath, fields);
html = await page.text();
ok("onboarding requested", html.includes("Onboarding"));

// ---------- 5. Admin: set LIVE + commission ----------
page = await req(admin2, "/admin/clients");
html = await page.text();
ok("admin sees onboarding queue", html.includes("Café E2E") && html.includes("Waiting for onboarding"));

fields = formFields(html, "tenantSlug");
page = await postAction(admin2, "/admin/clients", fields, { tenantSlug: "cafe-e2e" });
html = await page.text();
ok("client marked LIVE", html.includes("cafe-e2e") && html.includes("Live"));

page = await req(admin2, "/admin/partners");
html = await page.text();
const partnerAdminPath = /href="(\/admin\/partners\/[^"]+)"/.exec(html)?.[1];
page = await req(admin2, partnerAdminPath);
html = await page.text();
fields = formFields(html, "partnerId");
page = await postAction(admin2, partnerAdminPath, fields, { amount: "250", note: "Café E2E go-live bonus" });
html = await page.text();
ok("commission recorded", html.includes("go-live bonus"));

// ---------- 6. Partner ledger ----------
page = await req(pjar, "/dashboard/ledger");
html = await page.text();
ok("partner ledger shows entry + balance", html.includes("go-live bonus") && html.includes("250"));

// ---------- 7. Onboard a paying (reseller) partner + welcome panel ----------
// Distinct email so this exercises the fresh-partner branch of onboarding.
const onboardEmail = applicantEmail.replace("@", "+onboard@");
page = await req(admin2, "/admin/onboard");
html = await page.text();
ok("admin onboard page renders", page.status === 200 && html.includes("Onboard a partner"));

fields = formFields(html, "restaurantName");
page = await postAction(admin2, "/admin/onboard", fields, {
  name: "Onboard E2E",
  email: onboardEmail,
  tenantSlug: "onboard-e2e",
  restaurantName: "Onboard Café",
  amount: "89.00",
  interval: "month",
  liveSince: "2026-06-29",
});
html = await page.text();
const onboardInvite = decode(/https?:\/\/[^<\s"]*\/invite\/[A-Za-z0-9_-]+/.exec(html)?.[0] ?? "");
ok("onboard returns invite link", Boolean(onboardInvite), onboardInvite ? "link captured" : "not found");

if (onboardInvite) {
  const oJar = new Jar();
  const oInvitePath = new URL(onboardInvite).pathname;
  page = await req(oJar, oInvitePath);
  const oPwFields = formFields(await page.text(), "purpose");
  const oPass = "e2e-Onboard-Pass-42";
  await postAction(oJar, oInvitePath, oPwFields, { password: oPass, confirm: oPass });

  const opJar = new Jar();
  await login(opJar, onboardEmail, oPass);
  page = await req(opJar, "/dashboard");
  html = await page.text();
  ok(
    "onboarded partner sees welcome + pay CTA",
    html.includes("Onboard Café") && html.includes("Start auto-monthly payment"),
  );

  page = await req(opJar, "/dashboard/billing");
  html = await page.text();
  ok(
    "billing page shows the pending plan",
    html.includes("Onboard Café") && html.includes("Awaiting your first payment"),
  );
  // Stop here — clicking "Start auto-monthly payment" hits Mollie (live key).
}

// ---------- 8. Forgot password (no enumeration) ----------
page = await req(new Jar(), "/forgot");
ok("forgot page renders", page.status === 200);

console.log(failures === 0 ? "\nE2E: ALL PASS" : `\nE2E: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
