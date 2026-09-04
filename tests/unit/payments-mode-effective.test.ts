import { describe, expect, it } from "vitest";
import { effectivePaymentsMode } from "@/lib/payments-mode-effective";

// SOFRA-PAYMENTS-PRICING-MODE-PLAN §3, S2a: the registry-PR window between what
// TenantBilling INTENDS and what tenants/registry.yml actually ENFORCES.

describe("effectivePaymentsMode", () => {
  it("is commission, not pending, when the registry agrees", () => {
    expect(
      effectivePaymentsMode({ intended: "commission", registryBps: 150, registryReadable: true }),
    ).toEqual({ mode: "commission", pending: false });
  });

  it("is flat, not pending, when the registry agrees at an explicit 0", () => {
    expect(
      effectivePaymentsMode({ intended: "flat", registryBps: 0, registryReadable: true }),
    ).toEqual({ mode: "flat", pending: false });
  });

  it("treats an absent registry key the same as an explicit 0 bps — flat, per the registry's own documented default", () => {
    expect(
      effectivePaymentsMode({ intended: "flat", registryBps: undefined, registryReadable: true }),
    ).toEqual({ mode: "flat", pending: false });
  });

  it("is pending — effective flat — while the registry PR for a fresh commission switch hasn't merged yet", () => {
    // The exact window the plan describes: set in Prisma, registry PR still open.
    expect(
      effectivePaymentsMode({ intended: "commission", registryBps: 0, registryReadable: true }),
    ).toEqual({ mode: "flat", pending: true });
    expect(
      effectivePaymentsMode({ intended: "commission", registryBps: undefined, registryReadable: true }),
    ).toEqual({ mode: "flat", pending: true });
  });

  it("is pending the other direction too — a registry rate ahead of a stale intent", () => {
    expect(
      effectivePaymentsMode({ intended: "flat", registryBps: 150, registryReadable: true }),
    ).toEqual({ mode: "commission", pending: true });
  });

  it("is SILENT when the registry could not be read — reports the intent, never a manufactured pending claim", () => {
    // The trap this exists for: our own ops failure must never render as "this
    // tenant's money is still being switched over" — see lib/payments-pending.ts,
    // whose fail-quiet direction this mirrors exactly.
    expect(
      effectivePaymentsMode({ intended: "commission", registryBps: undefined, registryReadable: false }),
    ).toEqual({ mode: "commission", pending: false });
    expect(
      effectivePaymentsMode({ intended: "flat", registryBps: undefined, registryReadable: false }),
    ).toEqual({ mode: "flat", pending: false });
    // …even when a (stale) registry figure WAS available, unreadable still wins:
    // an outage mid-read is not evidence the value in hand is current.
    expect(
      effectivePaymentsMode({ intended: "flat", registryBps: 150, registryReadable: false }),
    ).toEqual({ mode: "flat", pending: false });
  });
});
