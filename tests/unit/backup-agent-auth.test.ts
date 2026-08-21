import { describe, expect, it } from "vitest";
import {
  ANY_BOX,
  authenticatedBox,
  backupAgentConfigured,
  boxAuthorized,
  envNameForBox,
} from "@/lib/backup-agent-auth";

// One credential per PRINCIPAL, not per environment. The property under test is
// that the staging box's bearer cannot act as prod — the push PRUNES, so without
// this the weaker box could erase the control plane's record of the paying
// tenant's backups and leave the page and the alarm both saying the opposite of
// the truth.

const req = (token?: string) =>
  new Request("https://sofrapiwas.com/api/telemetry/backups", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const env = {
  BACKUP_AGENT_SECRET_PROD: "prod-secret",
  BACKUP_AGENT_SECRET_STAGING: "staging-secret",
};

describe("envNameForBox", () => {
  it("uppercases, and turns what a shell cannot hold into underscores", () => {
    expect(envNameForBox("prod")).toBe("BACKUP_AGENT_SECRET_PROD");
    // Registry slugs may contain a hyphen; a shell variable name may not.
    expect(envNameForBox("e2e-backup-box")).toBe("BACKUP_AGENT_SECRET_E2E_BACKUP_BOX");
  });
});

describe("backupAgentConfigured", () => {
  it("is true for either shape, false for neither", () => {
    expect(backupAgentConfigured(env)).toBe(true);
    expect(backupAgentConfigured({ BACKUP_AGENT_SECRET: "shared" })).toBe(true);
    expect(backupAgentConfigured({})).toBe(false);
    // An empty value is not a configuration — it is the unset case spelled out.
    expect(backupAgentConfigured({ BACKUP_AGENT_SECRET_PROD: "" })).toBe(false);
  });
});

describe("authenticatedBox", () => {
  it("names the box whose secret was presented", () => {
    expect(authenticatedBox(req("prod-secret"), env)).toBe("prod");
    expect(authenticatedBox(req("staging-secret"), env)).toBe("staging");
  });

  it("refuses a wrong or absent bearer", () => {
    expect(authenticatedBox(req("nope"), env)).toBeNull();
    expect(authenticatedBox(req(), env)).toBeNull();
    expect(authenticatedBox(req("prod-secret"), {})).toBeNull();
  });

  it("refuses an AMBIGUOUS credential rather than guessing", () => {
    // Two boxes configured with the same value is an operator error. Picking one
    // would make an identity depend on object key order.
    const shared = { BACKUP_AGENT_SECRET_PROD: "same", BACKUP_AGENT_SECRET_STAGING: "same" };
    expect(authenticatedBox(req("same"), shared)).toBeNull();
  });

  it("still accepts the legacy shared secret, as ANY box", () => {
    // The rollout depends on this: the strict form alone would require the code
    // and both boxes' .env to change in the same instant, and getting that wrong
    // makes every box go silent — which the alarm reads as unprotected.
    expect(authenticatedBox(req("shared"), { BACKUP_AGENT_SECRET: "shared" })).toBe(ANY_BOX);
  });

  it("prefers a per-box match over the shared one", () => {
    const both = { ...env, BACKUP_AGENT_SECRET: "shared" };
    expect(authenticatedBox(req("prod-secret"), both)).toBe("prod");
    expect(authenticatedBox(req("shared"), both)).toBe(ANY_BOX);
  });
});

describe("boxAuthorized — the binding that is the whole point", () => {
  it("lets a box act as itself and as nothing else", () => {
    expect(boxAuthorized("staging", "staging")).toBe(true);
    expect(boxAuthorized("staging", "prod")).toBe(false);
    expect(boxAuthorized("prod", "staging")).toBe(false);
  });

  it("matches the env spelling to the registry spelling", () => {
    // BACKUP_AGENT_SECRET_E2E_BACKUP_BOX authenticates the box called e2e-backup-box.
    expect(boxAuthorized("e2e_backup_box", "e2e-backup-box")).toBe(true);
    expect(boxAuthorized("e2e_backup_box", "e2e-backup-other")).toBe(false);
  });

  it("lets the legacy shared secret act as any box, and null as none", () => {
    expect(boxAuthorized(ANY_BOX, "prod")).toBe(true);
    expect(boxAuthorized(null, "prod")).toBe(false);
  });
});
