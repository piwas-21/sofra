import type { MetadataRoute } from "next";
import { IS_CANONICAL_SITE, SITE_URL } from "@/lib/seo";

// Keep policy by purpose clear: search/citation fetchers, user-requested fetches,
// model-development controls, and the Common Crawl archive crawler are distinct.
// These are explicit allows for transparency; the wildcard allow remains the
// actual baseline. Do not fingerprint-block any of them in WAF/Caddy rules.
const CRAWLER_GROUPS = [
  { purpose: "search", userAgents: ["OAI-SearchBot", "PerplexityBot"] },
  { purpose: "user-requested fetch", userAgents: ["ChatGPT-User", "Claude-User"] },
  { purpose: "model development", userAgents: ["GPTBot", "ClaudeBot", "Google-Extended"] },
  { purpose: "web archive", userAgents: ["CCBot"] },
] as const;

/**
 * `robots.txt` — allow-all on the canonical site, DISALLOW-all anywhere else.
 *
 * The second half exists because this image is now also deployed to
 * `staging.sofrapiwas.com`, and a publicly reachable copy of the marketing site is not a
 * neutral thing to have. Left allow-all it would invite the crawlers listed above onto a
 * TWIN of the pages the AEO work exists to get cited — competing with the real site for
 * the same citations, on content that is by definition ahead of what we have decided to
 * publish. The control plane behind it is auth-gated, but its login and signup pages are
 * not, and a staging signup form in a search result is its own kind of bad.
 *
 * Keyed on the deployment's own base URL rather than a separate flag, so it is
 * self-correcting: any deployment that is not the canonical host is noindex without
 * anyone remembering to set anything. Caddy adds `X-Robots-Tag: noindex` on the staging
 * host as well, for the crawlers that ignore this file.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_CANONICAL_SITE) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      ...CRAWLER_GROUPS.flatMap(({ userAgents }) =>
        userAgents.map((userAgent) => ({ userAgent, allow: "/" })),
      ),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
