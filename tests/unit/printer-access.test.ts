import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptPrinterKey, encryptPrinterKey, fingerprint, newPrinterKey,
  printerCredentialsConfigured } from "@/lib/printer-credential-crypto";
import { printerAgentFresh, printerReportSchema, printerTenantEligible } from "@/lib/printer-access-policy";
import { authenticatedPrinterBox } from "@/lib/printer-agent-auth";
import type { RegistryTenant } from "@/lib/tenant-registry";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
describe("printer credential custody", () => {
  it("encrypts randomly and authenticates tenant, purpose, ciphertext and encryption key", () => {
    process.env.PRINTER_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const key = newPrinterKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(key)).toHaveLength(64);
    expect(printerCredentialsConfigured()).toBe(true);
    const value = encryptPrinterKey(key, "demo:current");
    expect(value).not.toContain(key);
    expect(encryptPrinterKey(key, "demo:current")).not.toBe(value);
    expect(decryptPrinterKey(value, "demo:current")).toBe(key);
    expect(() => decryptPrinterKey(value, "other:current")).toThrow();
    expect(() => decryptPrinterKey(value, "demo:pending")).toThrow();
    expect(() => decryptPrinterKey(value.slice(0, -2) + (parseInt(value.slice(-2), 16) ^ 255).toString(16).padStart(2, "0"), "demo:current")).toThrow();
    process.env.PRINTER_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    expect(() => decryptPrinterKey(value, "demo:current")).toThrow();
    expect(() => decryptPrinterKey("v2", "demo:current")).toThrow();
  });
  it("fails closed when encryption is missing or malformed", () => {
    delete process.env.PRINTER_CREDENTIAL_ENCRYPTION_KEY;
    expect(printerCredentialsConfigured()).toBe(false);
    expect(() => encryptPrinterKey("test", "demo:current")).toThrow();
    process.env.PRINTER_CREDENTIAL_ENCRYPTION_KEY = "invalid";
    expect(printerCredentialsConfigured()).toBe(false);
  });
  it("requires one distinct box principal", () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("PRINTER_AGENT_SECRET_")) delete process.env[name];
    const secret = newPrinterKey();
    const request = new Request("https://example.test", { headers: { authorization: `Bearer ${secret}` } });
    expect(authenticatedPrinterBox(request)).toBeNull();
    process.env.PRINTER_AGENT_SECRET_STAGING = secret;
    expect(authenticatedPrinterBox(request)).toBe("staging");
    expect(authenticatedPrinterBox(new Request("https://example.test"))).toBeNull();
    process.env.PRINTER_AGENT_SECRET_PROD = secret;
    expect(authenticatedPrinterBox(request)).toBeNull();
  });
  it("rejects duplicate, malformed and oversized reports", () => {
    const item = { tenantSlug: "demo", key: newPrinterKey(), verified: true, renewable: true };
    expect(printerReportSchema.safeParse({ box: "staging", credentials: [item] }).success).toBe(true);
    expect(printerReportSchema.safeParse({ box: "staging", credentials: [item, item] }).success).toBe(false);
    expect(printerReportSchema.safeParse({ box: "staging", credentials: [{ ...item, key: "bad\nheader" }] }).success).toBe(false);
    expect(printerReportSchema.safeParse({ box: "staging", credentials: [{ ...item, tenantSlug: "../prod" }] }).success).toBe(false);
    expect(printerReportSchema.safeParse({ box: "staging", credentials: Array(101).fill(item) }).success).toBe(false);
  });
  it("requires a fresh non-future report and an active printing tenant", () => {
    expect(printerAgentFresh(null)).toBe(false);
    expect(printerAgentFresh(new Date(0), 299_999)).toBe(true);
    expect(printerAgentFresh(new Date(0), 300_000)).toBe(false);
    expect(printerAgentFresh(new Date(100), 0)).toBe(false);
    const tenant = { status: "active", modules: ["printing"], managed: "scripts" } as RegistryTenant;
    expect(printerTenantEligible(tenant)).toBe(true);
    expect(printerTenantEligible({ ...tenant, status: "retired" })).toBe(false);
    expect(printerTenantEligible({ ...tenant, modules: [] })).toBe(false);
    expect(printerTenantEligible({ ...tenant, modules: [], managed: "legacy" })).toBe(true);
  });
});
