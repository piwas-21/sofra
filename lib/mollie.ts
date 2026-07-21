// Minimal typed Mollie v2 client (fetch-based, no SDK dep — mirrors the
// Resend pattern in lib/email.ts). SofraPiwas→tenant subscription billing only
// (ADR-005/ADR-011 Job A): customers + first payments (mandate creation) +
// subscriptions. Auth is a plain API key; test_/live_ prefix selects mode.
//
// Mollie webhooks are NOT signed — the webhook handler must treat the posted
// id as untrusted and re-fetch the resource from this API (fetch-and-verify).

const MOLLIE_API = "https://api.mollie.com/v2";

export function mollieConfigured(): boolean {
  return Boolean(process.env.MOLLIE_API_KEY);
}

export class MollieError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`Mollie ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function mollie<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const key = process.env.MOLLIE_API_KEY;
  if (!key) throw new MollieError(503, "MOLLIE_API_KEY is not configured");
  const res = await fetch(`${MOLLIE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // Mollie dedupes retried POSTs on this header — callers pass a stable
      // key so a webhook retry can never create a second resource.
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { detail?: string; title?: string };
      detail = err.detail ?? err.title ?? detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new MollieError(res.status, detail);
  }
  // DELETE (e.g. cancel subscription) still returns the resource in Mollie v2.
  return (await res.json()) as T;
}

/** Integer cents -> Mollie amount object ({currency, value: "12.50"}). */
export function toAmount(cents: number, currency = "EUR") {
  return { currency, value: (cents / 100).toFixed(2) };
}

export type MollieCustomer = { id: string; name: string; email: string };

export type MolliePayment = {
  id: string;
  status: "open" | "pending" | "authorized" | "paid" | "failed" | "canceled" | "expired";
  amount: { currency: string; value: string };
  description: string;
  method: string | null;
  customerId?: string;
  subscriptionId?: string;
  sequenceType: "oneoff" | "first" | "recurring";
  paidAt?: string;
  _links: { checkout?: { href: string } };
};

export type MollieMandate = {
  id: string;
  status: "valid" | "pending" | "invalid";
  method: string;
};

export type MollieSubscription = {
  id: string;
  status: "pending" | "active" | "canceled" | "suspended" | "completed";
  amount: { currency: string; value: string };
  interval: string;
  description: string;
  startDate: string;
};

export function createCustomer(input: { name: string; email: string }) {
  return mollie<MollieCustomer>("POST", "/customers", input);
}

/**
 * First payment (sequenceType "first"): the tenant completes a hosted
 * checkout once, which both collects the first period and creates the
 * recurring mandate the subscription then charges against.
 */
export function createFirstPayment(
  customerId: string,
  input: {
    amountCents: number;
    currency?: string;
    description: string;
    redirectUrl: string;
    webhookUrl: string;
  },
) {
  return mollie<MolliePayment>("POST", "/payments", {
    amount: toAmount(input.amountCents, input.currency),
    description: input.description,
    redirectUrl: input.redirectUrl,
    webhookUrl: input.webhookUrl,
    customerId,
    sequenceType: "first",
  });
}

export function getPayment(paymentId: string) {
  return mollie<MolliePayment>("GET", `/payments/${paymentId}`);
}

export async function hasValidMandate(customerId: string): Promise<boolean> {
  const res = await mollie<{ _embedded?: { mandates?: MollieMandate[] } }>(
    "GET",
    `/customers/${customerId}/mandates`,
  );
  return (res._embedded?.mandates ?? []).some((m) => m.status === "valid");
}

/**
 * interval: Mollie grammar ("1 month", "3 months", "12 months").
 * startDate: YYYY-MM-DD — first charge date (the first period was already
 * collected by the first payment, so this is one interval out).
 * idempotencyKey: stable per plan (e.g. the BillingSubscription id) so
 * retries can never create a duplicate charging subscription.
 */
export function createSubscription(
  customerId: string,
  input: {
    amountCents: number;
    currency?: string;
    interval: string;
    description: string;
    webhookUrl: string;
    startDate: string;
    idempotencyKey: string;
  },
) {
  return mollie<MollieSubscription>(
    "POST",
    `/customers/${customerId}/subscriptions`,
    {
      amount: toAmount(input.amountCents, input.currency),
      interval: input.interval,
      description: input.description,
      webhookUrl: input.webhookUrl,
      startDate: input.startDate,
    },
    input.idempotencyKey,
  );
}

export function cancelSubscription(customerId: string, subscriptionId: string) {
  return mollie<MollieSubscription>(
    "DELETE",
    `/customers/${customerId}/subscriptions/${subscriptionId}`,
  );
}
