import { describe, expect, it } from "vitest";
import {
  tenantForgotPasswordUrl,
  tenantOrigin,
  tenantStage,
  visibleTenantStage,
  type TenantStageFacts,
} from "@/lib/tenant-liveness";

const facts = (over: Partial<TenantStageFacts> = {}): TenantStageFacts => ({
  paid: true,
  provisioningPrUrl: null,
  registryDomain: null,
  healthy: false,
  ...over,
});

describe("tenantStage", () => {
  it("says nothing before the first payment settles", () => {
    // The pay button and ActivatingPanel own this moment; a third voice about the app
    // next to "pay now" is noise.
    expect(tenantStage(facts({ paid: false }))).toBe("none");
    expect(
      tenantStage(facts({ paid: false, registryDomain: "x.sofrapiwas.com", healthy: true })),
    ).toBe("none");
  });

  it("is 'ready' only when the app was observed serving", () => {
    expect(tenantStage(facts({ registryDomain: "x.sofrapiwas.com", healthy: true }))).toBe("ready");
  });

  it("does NOT claim ready from a registry entry alone", () => {
    // A merged entry means the chain started, not that the build and provision
    // finished. This is the whole reason the probe exists.
    expect(tenantStage(facts({ registryDomain: "x.sofrapiwas.com", healthy: false }))).toBe(
      "almostReady",
    );
  });

  it("does NOT claim ready from a stale `healthy` with no registry entry", () => {
    // Guards against a caller that keeps a health answer around after the entry is
    // gone. `healthy` alone must never be sufficient.
    expect(tenantStage(facts({ healthy: true }))).toBe("preparing");
    expect(tenantStage(facts({ healthy: true, provisioningPrUrl: "https://gh/pr/1" }))).toBe(
      "settingUp",
    );
  });

  it("degrades to 'settingUp' on an open proposal, 'preparing' on nothing", () => {
    expect(tenantStage(facts({ provisioningPrUrl: "https://gh/pr/1" }))).toBe("settingUp");
    expect(tenantStage(facts())).toBe("preparing");
  });

  it("treats an unreadable registry exactly like no entry — never like a live tenant", () => {
    // registryDomains() collapses a registry read failure to `null`, so this is the
    // shape that reaches the classifier during an ops outage. It must fall BACKWARD.
    expect(
      tenantStage(facts({ registryDomain: null, provisioningPrUrl: "https://gh/pr/1", healthy: true })),
    ).toBe("settingUp");
  });
});

describe("tenantOrigin", () => {
  it("accepts a bare host", () => {
    expect(tenantOrigin("demo.sofrapiwas.com")).toBe("https://demo.sofrapiwas.com");
    expect(tenantOrigin("www.rumirestaurant.ch")).toBe("https://www.rumirestaurant.ch");
  });

  it("rejects anything that is not a bare host", () => {
    // The value reaches here from a registry entry whose slug half was typed by a
    // customer. It becomes both a link we tell the owner to click and a request this
    // server makes, so a scheme, credentials, port, path or query is refused outright
    // rather than normalised into something that still resolves somewhere.
    for (const bad of [
      "https://demo.sofrapiwas.com",
      "evil.example.com/path",
      "user:pass@evil.example.com",
      "demo.sofrapiwas.com:8080",
      "demo.sofrapiwas.com?x=1",
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "backend",
      "-leading.example.com",
      "trailing-.example.com",
      "",
      " demo.sofrapiwas.com",
    ]) {
      expect(tenantOrigin(bad), bad).toBeNull();
    }
  });
});

describe("tenantForgotPasswordUrl", () => {
  it("points at the tenant's own reset page — the O3 mechanism, on their box", () => {
    expect(tenantForgotPasswordUrl("demo.sofrapiwas.com")).toBe(
      "https://demo.sofrapiwas.com/forgot-password",
    );
  });

  it("is null when the origin is refused, so the panel cannot render a broken link", () => {
    expect(tenantForgotPasswordUrl("evil.example.com/path")).toBeNull();
  });
});

describe("visibleTenantStage", () => {
  it("is a pass-through outside the mandate-lag window", () => {
    for (const s of ["none", "preparing", "settingUp", "almostReady", "ready"] as const) {
      expect(visibleTenantStage(s, false)).toBe(s);
    }
  });

  it("silences the waiting copy that ActivatingPanel is already saying", () => {
    // "We are preparing your app" under a panel that opens with "your first payment
    // went through … then your app is prepared" is the same sentence twice.
    expect(visibleTenantStage("preparing", true)).toBe("none");
    expect(visibleTenantStage("settingUp", true)).toBe("none");
  });

  it("keeps the stages that are NEW information mid-activation", () => {
    // ActivatingPanel cannot know the app exists; these two do, so they still speak.
    expect(visibleTenantStage("almostReady", true)).toBe("almostReady");
    expect(visibleTenantStage("ready", true)).toBe("ready");
  });
});
