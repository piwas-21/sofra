// Should a settled charge send the CUSTOMER a receipt?
//
// Pure decision, separated from the send for the same reason `invoice-rules` and
// `auto-provision-policy` are: it is the part with the edge cases, and it is the
// part worth testing without a database or an HTTP client in the way.
//
// The gap this closes (EMAIL-SPEC-CONTROL-PLANE G2): a self-serve buyer paid and
// heard nothing. The founder got a notification; the customer got silence unless
// their charge happened to be invoiceable, or happened to be blocked on details
// they could fix. "You were charged" is not an optional courtesy — it is the mail
// people look for when they doubt whether a payment went through, and its absence
// generates the support message it should have prevented.

/** Everything the decision needs. No Prisma types on purpose — the caller adapts. */
export type ReceiptInput = {
  /** Mollie status, verbatim. */
  status: string;
  /** An Invoice row already exists for this payment. */
  invoiceIssued: boolean;
  /** We have already sent a receipt for this payment (audit row present). */
  alreadySent: boolean;
  /** The payer address we would send to. */
  to: string | null | undefined;
};

export type ReceiptVerdict =
  | { send: true }
  | {
      send: false;
      /** Why not — recorded, so "no receipt" is never a silent state. */
      reason: "notSettled" | "invoiceCoversIt" | "alreadySent" | "noRecipient";
    };

export function receiptDecision(input: ReceiptInput): ReceiptVerdict {
  // Only a settled charge is a receipt. `failed`/`expired`/`canceled` are dunning
  // and deliberately out of scope here (see G6 — dunning is its own message with
  // its own call to action, and sending "here is your receipt" for a failed charge
  // would be worse than sending nothing).
  if (input.status !== "paid") return { send: false, reason: "notSettled" };

  // An invoice IS the receipt, and a better one — it is the fiscal document, it is
  // already mailed by `invoice-email.ts`, and it carries the tax treatment. Two
  // mails for one charge reads as a double charge, which is precisely the anxiety
  // a receipt exists to remove.
  if (input.invoiceIssued) return { send: false, reason: "invoiceCoversIt" };

  // Mollie redelivers webhooks freely — up to ~26h through the mandate race, where
  // the webhook answers 503 on purpose (lib/billing.ts). Every redelivery re-runs
  // this path, so without a marker the customer is thanked for the same payment
  // over and over. Same reasoning, and the same audit-row marker, as
  // `invoice-blocked.ts`.
  if (input.alreadySent) return { send: false, reason: "alreadySent" };

  if (!input.to) return { send: false, reason: "noRecipient" };

  return { send: true };
}
