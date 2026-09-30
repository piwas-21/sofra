#!/usr/bin/env node
// Inspect production-shaped HTTP output after a standalone build. Expected
// routes/locales are explicit so the SEO helpers are not their own test oracle.
import assert from "node:assert/strict";
import { cpSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const serverFile = path.join(standalone, "server.js");
const canonicalOrigin = "https://sofrapiwas.com";
const stagingOrigin = "https://staging.sofrapiwas.com";
const expectedOrigin = process.env.SEO_EXPECTED_ORIGIN ?? canonicalOrigin;
const canonicalBuild = expectedOrigin === canonicalOrigin;
if (expectedOrigin !== canonicalOrigin && expectedOrigin !== stagingOrigin) {
  throw new Error("SEO_EXPECTED_ORIGIN must be the canonical or staging origin.");
}
const locales = ["en", "fr", "de", "nl", "tr", "ar"];
const publicPaths = [
  "", "/signup", "/case/rumi", "/compare/alternatives", "/compare/gloriafood",
  "/changelog", "/guides/qr-menu-switzerland", "/guides/qr-menu-geneva",
];
const discoveryPaths = new Set([
  "/compare/alternatives", "/guides/qr-menu-switzerland", "/guides/qr-menu-geneva",
]);
const crawler = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const crawlerNames = [
  "OAI-SearchBot", "PerplexityBot", "ChatGPT-User", "Claude-User",
  "GPTBot", "ClaudeBot", "Google-Extended", "CCBot",
];

if (!existsSync(serverFile)) {
  throw new Error("Build standalone output first: .next/standalone/server.js is missing.");
}
for (const relative of [".next/static", "public"]) {
  const source = path.join(root, relative);
  const target = relative === "public"
    ? path.join(standalone, "public")
    : path.join(standalone, ".next", "static");
  if (existsSync(source)) cpSync(source, target, { recursive: true, force: true });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) =>
    listener.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => error ? reject(error) : resolve()),
  );
  return port;
}

async function withServer(identity, run) {
  const port = await freePort();
  const output = { text: "" };
  const env = {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_PUBLIC_SITE_URL: expectedOrigin,
    AUTH_SECRET: "crawl-contract-only-not-a-real-secret",
    AUTH_TRUST_HOST: "true",
    NEXTAUTH_URL: expectedOrigin,
    DATABASE_URL: "postgresql://127.0.0.1:1/unused",
    SOFRA_LEGAL_NAME: "",
    SOFRA_LEGAL_ADDRESS: "",
    SOFRA_LEGAL_POSTAL: "",
    SOFRA_LEGAL_CITY: "",
    SOFRA_LEGAL_COUNTRY: "",
    SOFRA_KVK: "",
    SOFRA_VAT_NUMBER: "",
    SOFRA_LEGAL_EMAIL: "",
    ...identity,
  };
  const child = spawn(process.execPath, [serverFile], {
    cwd: standalone,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { output.text = (output.text + chunk).slice(-3000); });
  }
  const origin = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 45_000;
  try {
    await waitForServer(origin, child, output, deadline, "no HTTP response");
    return await run(origin);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(3000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

async function waitForServer(origin, child, output, deadline, lastCheck) {
  if (child.exitCode !== null) {
    throw new Error("Server exited " + child.exitCode + ": " + output.text);
  }
  if (Date.now() >= deadline) {
    throw new Error("Server did not serve /robots.txt (" + lastCheck + "): " + output.text);
  }
  try {
    const response = await fetch(origin + "/robots.txt", { signal: AbortSignal.timeout(1500) });
    if (response.status === 200) return;
    lastCheck = "HTTP " + response.status + " from /robots.txt";
  } catch (error) {
    lastCheck = error instanceof Error ? error.message : String(error);
  }
  await wait(250);
  return waitForServer(origin, child, output, deadline, lastCheck);
}

function attr(tag, name) {
  return tag.match(new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, "i"))?.[1];
}
function headOf(html, label) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head, label + ": emitted response has no complete <head>");
  return head;
}
function tagsIn(head, name) {
  return [...head.matchAll(new RegExp(String.raw`<${name}\b[^>]*>`, "gi"))].map(([tag]) => tag);
}
function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
function normalizeText(value) {
  return value.replaceAll("\u00a0", " ").replaceAll(/\s+/g, " ").trim();
}
function visibleText(html) {
  return normalizeText(decodeHtml(
    html
      .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replaceAll(/<[^<>]*>/g, " "),
  ));
}
const knownMessageNamespaces = new Set([
  "meta", "header", "hero", "features", "how", "showcase", "pricing", "partner",
  "waitlist", "auth", "footer", "faq", "caseStudy", "compare", "changelog", "control",
  "signup", "legal", "onboardingPayments", "discovery",
]);
function verifyVisibleBody(html, label) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  assert.ok(body, label + ": response has a body");
  const h1 = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const heading = visibleText(h1);
  const text = visibleText(body);
  assert.ok(heading.length >= 5, label + ": raw HTML has a meaningful H1");
  assert.ok(text.length >= 100, label + ": raw HTML has meaningful body text");
  assert.ok(text.includes(heading), label + ": H1 is present in visible body text");
  const unresolvedKeys = [...text.matchAll(/\b([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)\b/g)]
    .map(([, key]) => key)
    .filter((key) => knownMessageNamespaces.has(key.split(".")[0]));
  assert.deepEqual(unresolvedKeys, [], label + ": visible text must not contain an unresolved message key");
  assert.doesNotMatch(text, /\{\s*[A-Za-z][\w.]*\s*\}/, label + ": visible text must not contain an unresolved message variable");
  assert.doesNotMatch(text, /MISSING_MESSAGE|MISSING_VALUE|IntlError/i, label + ": visible text must not contain next-intl errors");
}
function jsonLdBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(([, json]) => JSON.parse(json));
}
function verifyCrawlableLink(html, href, label) {
  assert.ok(
    hasCrawlableLink(html, href),
    label + ": crawlable link " + href,
  );
}
function hasCrawlableLink(html, href) {
  return tagsIn(html, "a").some((tag) => {
    const actualHref = attr(tag, "href");
    return actualHref === href || actualHref === href + "/";
  });
}
assert.equal(hasCrawlableLink('<a href="/en/foo">', "/en/foo"), true, "link matcher accepts an exact href");
assert.equal(hasCrawlableLink('<a href="/en/foo/">', "/en/foo"), true, "link matcher accepts a trailing slash");
assert.equal(hasCrawlableLink('<a href="/en/foo-not-a-route">', "/en/foo"), false, "link matcher rejects an href prefix");
function verifyDocument(html, locale, route, indexable, alternates) {
  const label = "/" + locale + route;
  verifyVisibleBody(html, label);
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  assert.equal(attr(htmlTag, "lang"), locale, label + ": html lang");
  assert.equal(attr(htmlTag, "dir"), locale === "ar" ? "rtl" : "ltr", label + ": html dir");

  const head = headOf(html, label);
  const linkTags = tagsIn(head, "link");
  assert.match(head, /<title>[^<]+<\/title>/i, label + ": localized title");
  const description = tagsIn(head, "meta").find((tag) => attr(tag, "name") === "description");
  assert.ok(attr(description ?? "", "content")?.trim(), label + ": localized description");
  const canonical = linkTags.find((tag) => attr(tag, "rel") === "canonical");
  assert.equal(attr(canonical ?? "", "href"), expectedOrigin + label, label + ": canonical");
  const robots = tagsIn(head, "meta").find((tag) => attr(tag, "name") === "robots");
  const directives = attr(robots ?? "", "content") ?? "";
  assert.match(directives, indexable ? /\bindex\b/i : /\bnoindex\b/i, label + ": index policy");
  assert.match(directives, /\bfollow\b/i, label + ": follow policy");

  const alternateTags = linkTags.filter((tag) => attr(tag, "hreflang"));
  if (!alternates) {
    assert.equal(alternateTags.length, 0, label + ": nonindexable route must not advertise hreflang");
    for (const language of locales) {
      verifyCrawlableLink(html, "/" + language + route, label + ": locale " + language);
    }
    return;
  }
  const actual = Object.fromEntries(alternateTags.map((tag) => [attr(tag, "hreflang"), attr(tag, "href")]));
  const expected = Object.fromEntries([
    ...locales.map((language) => [language, expectedOrigin + "/" + language + route]),
    ["x-default", expectedOrigin + "/en" + route],
  ]);
  assert.deepEqual(actual, expected, label + ": reciprocal six-locale alternates");
  for (const language of locales) {
    const href = "/" + language + route;
    verifyCrawlableLink(html, href, label + ": locale " + language);
  }
}

async function getText(origin, route, headers = {}) {
  const response = await fetch(origin + route, {
    headers: { "user-agent": crawler, ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  assert.equal(response.status, 200, route + ": expected 200, got " + response.status);
  return body;
}

function verifySitemap(xml, includeLegal) {
  assert.doesNotMatch(xml, /<(?:lastmod|changefreq|priority)>/i, "sitemap must not invent dates or importance");
  if (!canonicalBuild) {
    assert.match(xml, /<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/i);
    assert.doesNotMatch(xml, /<url>|<loc>/i, "noncanonical sitemap must not advertise staging URLs");
    return;
  }
  assert.match(xml, /<urlset\b[^>]*xmlns:xhtml=/i);
  const expectedPaths = [...publicPaths, ...(includeLegal ? ["/legal"] : [])];
  const expectedUrls = locales
    .flatMap((locale) => expectedPaths.map((route) => expectedOrigin + "/" + locale + route))
    .sort((left, right) => left.localeCompare(right));
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map(([, block]) => block);
  const actualUrls = entries
    .map((block) => block.match(/<loc>([^<]+)<\/loc>/i)?.[1] ?? "")
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(actualUrls, expectedUrls, "sitemap route inventory and conditional legal publication");
  for (const block of entries) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/i)?.[1] ?? "";
    const pathname = new URL(loc).pathname;
    const locale = pathname.split("/")[1];
    const suffix = pathname.slice(("/" + locale).length);
    const alternateTags = [...block.matchAll(/<xhtml:link\b[^>]*\/>/gi)].map(([tag]) => tag);
    const actual = Object.fromEntries(alternateTags.map((tag) => [attr(tag, "hreflang"), attr(tag, "href")]));
    const expected = Object.fromEntries([
      ...locales.map((language) => [language, expectedOrigin + "/" + language + suffix]),
      ["x-default", expectedOrigin + "/en" + suffix],
    ]);
    assert.ok(expectedPaths.includes(suffix), loc + ": expected a public route");
    assert.deepEqual(actual, expected, loc + ": sitemap alternate set is reciprocal");
  }
}

async function verifyRobots(origin) {
  const text = await getText(origin, "/robots.txt");
  assert.match(text, /User-Agent:\s*\*/i);
  if (!canonicalBuild) {
    assert.match(text, /^Disallow:\s*\//m, "noncanonical robots.txt must block crawling");
    assert.doesNotMatch(text, /^Sitemap:/im, "noncanonical robots.txt must not advertise a sitemap");
    return;
  }
  assert.match(text, /^Allow:\s*\//m);
  assert.match(text, /Sitemap:\s*https:\/\/sofrapiwas\.com\/sitemap\.xml/i);
  for (const name of crawlerNames) assert.ok(text.includes(name), "robots.txt must keep " + name + " explicitly allowed");
  assert.doesNotMatch(text, /^Disallow:\s*\//m, "canonical build must remain crawlable");
}
function verifyPrivateHead(html, route) {
  const tags = tagsIn(headOf(html, route), "meta");
  const robots = tags.find((tag) => attr(tag, "name") === "robots");
  const directives = attr(robots ?? "", "content") ?? "";
  assert.match(directives, /\bnoindex\b/i, route + " must remain noindex");
  assert.match(directives, /\bnofollow\b/i, route + " must remain nofollow");
}

function verifyLandingSchema(html) {
  const blocks = jsonLdBlocks(html);
  const application = blocks.find((entry) => entry["@type"] === "SoftwareApplication");
  assert.ok(application, "landing page must emit SoftwareApplication JSON-LD");
  assert.equal(application.offers, undefined, "configured plans must not become one universal price offer");
  assert.ok(!blocks.some((entry) => entry["@type"] === "Offer"), "unpublished terms must not appear as priced offers");
  const faq = blocks.find((entry) => entry["@type"] === "FAQPage");
  assert.ok(faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length > 0, "honest FAQPage semantics remain available");
  const faqMarkup = html.slice(html.indexOf('id="faq"')).split("</section>")[0];
  const faqSection = visibleText(faqMarkup);
  assert.equal((faqMarkup.match(/<summary\b/g) ?? []).length, faq.mainEntity.length, "FAQ schema count must match visible questions");
  for (const question of faq.mainEntity) {
    assert.ok(question.name && question.acceptedAnswer?.text, "FAQ schema entries need question and answer text");
    assert.ok(faqSection.includes(question.name), "visible FAQ section must contain each schema question");
    assert.ok(faqSection.includes(question.acceptedAnswer.text), "visible FAQ section must contain each schema answer");
  }
}

function verifyDiscoverySchema(html, locale, route) {
  const label = "/" + locale + route;
  const blocks = jsonLdBlocks(html);
  const page = blocks.find((entry) => entry["@type"] === "WebPage");
  assert.ok(page, label + ": WebPage JSON-LD is present");
  assert.equal(page["@id"], expectedOrigin + label, label + ": schema page identity uses the configured origin");
  assert.equal(page.inLanguage, locale, label + ": schema language matches the document");

  const head = headOf(html, label);
  const title = head.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const description = tagsIn(head, "meta").find((tag) => attr(tag, "name") === "description");
  assert.equal(page.name, decodeHtml(title), label + ": schema name matches emitted title");
  assert.equal(page.description, decodeHtml(attr(description ?? "", "content") ?? ""), label + ": schema description matches emitted metadata");

  const time = html.match(/<time\b[^>]*datetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/i);
  const checkedDate = time?.[1];
  assert.ok(checkedDate, label + ": visible source-check date exists");
  assert.equal(page.dateModified, checkedDate, label + ": schema freshness date matches visible date");

  if (route !== "/compare/alternatives") {
    assert.ok(!blocks.some((entry) => entry["@type"] === "FAQPage"), label + ": FAQ schema must only describe visible FAQs");
    return;
  }

  const checkedDateText = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(checkedDate));
  const notesSection = html.match(/<section\b[^>]*aria-labelledby="alternatives-table"[^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  const tableNote = notesSection.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  assert.ok(visibleText(time?.[2] ?? "").includes(checkedDateText), label + ": visible source date must match its machine-readable date");
  assert.ok(visibleText(tableNote).includes(checkedDateText), label + ": provider note must include its localized checked date");

  const faq = blocks.find((entry) => entry["@type"] === "FAQPage");
  assert.ok(faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length > 0, label + ": visible alternatives FAQs are represented");
  const bodyText = visibleText(html);
  for (const question of faq.mainEntity) {
    assert.ok(question.name && question.acceptedAnswer?.text, label + ": FAQ entries need question and answer text");
    assert.ok(bodyText.includes(normalizeText(question.name)), label + ": FAQ question is visible");
    assert.ok(bodyText.includes(normalizeText(question.acceptedAnswer.text)), label + ": FAQ answer is visible");
  }
}

await withServer({}, async (origin) => {
  await verifyRobots(origin);
  verifySitemap(await getText(origin, "/sitemap.xml"), false);
  const landingHtml = await getText(origin, "/en");
  verifyLandingSchema(landingHtml);
  for (const route of discoveryPaths) verifyCrawlableLink(landingHtml, "/en" + route, "English landing page");
  await Promise.all(publicPaths.flatMap((route) => locales.map(async (locale) => {
      const html = await getText(origin, "/" + locale + route);
      verifyDocument(html, locale, route, canonicalBuild, canonicalBuild);
      if (discoveryPaths.has(route)) {
        verifyDiscoverySchema(html, locale, route);
        for (const target of discoveryPaths) {
          verifyCrawlableLink(html, "/" + locale + target, "/" + locale + route + ": discovery route graph");
        }
      }
  })));
  await Promise.all(locales.map(async (locale) => {
    const legalHtml = await getText(origin, "/" + locale + "/legal");
    assert.ok(!legalHtml.includes("Example Company B.V."), "unpublished legal identity must not appear");
    verifyDocument(legalHtml, locale, "/legal", false, false);
  }));
  verifyPrivateHead(await getText(origin, "/login"), "control login");
  verifyPrivateHead(
    await getText(origin, "/en/onboarding/payments/discovery-contract-token"),
    "payment capability route",
  );

  const aliasHtml = await getText(origin, "/fr/changelog", { host: "sofra-alias.invalid" });
  const aliasHead = headOf(aliasHtml, "alias-host request");
  assert.ok(aliasHead.includes(expectedOrigin + "/fr/changelog"), "alias host must emit the configured origin");
  assert.ok(!aliasHead.includes("sofra-alias.invalid"), "alias must not become canonical or hreflang origin");
});

await withServer({
  SOFRA_LEGAL_NAME: "Example Company B.V.",
  SOFRA_LEGAL_ADDRESS: "Example Street 1",
  SOFRA_LEGAL_POSTAL: "1015 CJ",
  SOFRA_LEGAL_CITY: "Amsterdam",
  SOFRA_LEGAL_COUNTRY: "NL",
  SOFRA_KVK: "12345678",
  SOFRA_VAT_NUMBER: "NL123456789B01",
  SOFRA_LEGAL_EMAIL: "legal@example.test",
}, async (origin) => {
  verifySitemap(await getText(origin, "/sitemap.xml"), canonicalBuild);
  await Promise.all(locales.map(async (locale) => {
    const legalHtml = await getText(origin, "/" + locale + "/legal");
    assert.ok(legalHtml.includes("Example Company B.V."), "runtime legal identity must appear after publication");
    verifyDocument(legalHtml, locale, "/legal", canonicalBuild, canonicalBuild);
  }));
});

console.log("Marketing crawl output contract passed (HTML head, locale links, sitemap and robots).");
