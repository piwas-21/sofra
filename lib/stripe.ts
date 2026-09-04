// Minimal typed Stripe client (fetch-based, no SDK dep — mirrors the Mollie
// pattern in lib/mollie.ts, which itself mirrors the Resend pattern in
// lib/email.ts). Tenant-facing payments (ADR-011 Job B) run entirely in the
// backend against the tenant's own Stripe Connect setup; the ONE thing this
// app owns is the platform-level Connect webhook
// (app/api/webhooks/stripe/route.ts) and the two calls it makes to return an
// application fee when a connected account refunds a charge
// (lib/stripe-fee-refund.ts).
//
// Stripe does NOT accept JSON — request bodies are
// application/x-www-form-urlencoded, form-encoded via URLSearchParams.

const STRIPE_API = "https://api.stripe.com";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_API_KEY);
}

export class StripeError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(`Stripe ${status} (${code}): ${message}`);
    this.status = status;
    this.code = code;
  }
}

async function stripe<T>(
  method: "GET" | "POST",
  path: string,
  form?: Record<string, string>,
  opts?: { account?: string; idempotencyKey?: string },
): Promise<T> {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new StripeError(503, "not_configured", "STRIPE_API_KEY is not configured");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
    // Present ONLY when a caller passes an account: routes the request AT a
    // connected account instead of the platform. Omitting it entirely (not
    // sending it empty) is what makes a platform-owned resource reachable at
    // all — see lib/stripe-fee-refund.ts for which of the two each call needs.
    ...(opts?.account ? { "Stripe-Account": opts.account } : {}),
    // Stripe dedupes retried POSTs on this header — callers pass a stable key
    // so a webhook retry (or a race between two deliveries) can never create
    // a second resource.
    ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
  };
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!res.ok) {
    let code = "unknown";
    let message = res.statusText;
    try {
      const err = (await res.json()) as { error?: { code?: string; type?: string; message?: string } };
      code = err.error?.code ?? err.error?.type ?? code;
      message = err.error?.message ?? message;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new StripeError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export function stripeGet<T>(path: string, opts?: { account?: string }): Promise<T> {
  return stripe<T>("GET", path, undefined, opts);
}

export function stripePost<T>(
  path: string,
  form: Record<string, string>,
  opts?: { account?: string; idempotencyKey?: string },
): Promise<T> {
  return stripe<T>("POST", path, form, opts);
}
