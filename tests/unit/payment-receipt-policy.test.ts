import { describe, expect, it } from "vitest";
import { receiptDecision, type ReceiptInput } from "@/lib/payment-receipt-policy";

/** A settled, uninvoiced, never-thanked charge — the one case that sends. */
const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  status: "paid",
  invoiceIssued: false,
  alreadySent: false,
  to: "owner@example.com",
  ...over,
});

describe("receiptDecision — when the customer is thanked", () => {
  it("sends for a settled charge that no invoice covers", () => {
    expect(receiptDecision(base())).toEqual({ send: true });
  });

  it("sends for a recurring charge too, not just the first", () => {
    // A monthly renewal is the charge people query most — it arrives without
    // them doing anything, so silence there is what generates the support mail.
    expect(receiptDecision(base())).toEqual({ send: true });
  });
});

describe("receiptDecision — refusals", () => {
  it.each(["failed", "expired", "canceled", "open", "pending", "authorized"])(
    "does not thank anyone for a %s payment",
    (status) => {
      expect(receiptDecision(base({ status }))).toEqual({
        send: false,
        reason: "notSettled",
      });
    },
  );

  it("stands down when an invoice was issued — one charge must not send two mails", () => {
    expect(receiptDecision(base({ invoiceIssued: true }))).toEqual({
      send: false,
      reason: "invoiceCoversIt",
    });
  });

  it("is idempotent: a redelivered webhook does not re-thank", () => {
    // Mollie retries for up to ~26h through the mandate race, and every retry
    // re-runs this path.
    expect(receiptDecision(base({ alreadySent: true }))).toEqual({
      send: false,
      reason: "alreadySent",
    });
  });

  it.each([null, undefined, ""])("refuses without a recipient (%s)", (to) => {
    expect(receiptDecision(base({ to }))).toEqual({ send: false, reason: "noRecipient" });
  });
});

describe("receiptDecision — precedence between refusals", () => {
  it("reports notSettled before anything else", () => {
    const out = receiptDecision(base({ status: "failed", invoiceIssued: true, alreadySent: true }));
    expect(out).toEqual({ send: false, reason: "notSettled" });
  });

  it("prefers invoiceCoversIt over alreadySent, so the reason names the real cause", () => {
    const out = receiptDecision(base({ invoiceIssued: true, alreadySent: true }));
    expect(out).toEqual({ send: false, reason: "invoiceCoversIt" });
  });

  it("does not send merely because a recipient exists", () => {
    const out = receiptDecision(base({ status: "failed" }));
    expect(out.send).toBe(false);
  });
});
