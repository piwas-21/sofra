import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("robots policy", () => {
  it("allows search, user-requested, model-development and archive crawlers on canonical", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sofrapiwas.com");
    vi.resetModules();
    const { default: robots } = await import("@/app/robots");
    const policy = robots();

    expect(policy.sitemap).toBe("https://sofrapiwas.com/sitemap.xml");
    expect(policy.rules).toEqual(expect.arrayContaining([
      { userAgent: "*", allow: "/" },
      { userAgent: "OAI-SearchBot", allow: "/" },
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "ChatGPT-User", allow: "/" },
      { userAgent: "CCBot", allow: "/" },
    ]));
    expect(policy.rules).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ disallow: "/" }),
    ]));
  });

  it("disallows every crawler on a non-canonical deployment", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.sofrapiwas.com");
    vi.resetModules();
    const { default: robots } = await import("@/app/robots");

    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });
});
