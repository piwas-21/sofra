// WHICH webhook secret verifies a Stripe delivery — and why this endpoint has
// TWO of them (workspace docs/plans/BACKLOG.md, the second commission blocker).
//
// The two Stripe event scopes are ORTHOGONAL, and that is not a design choice
// of ours, it is Stripe's. MEASURED 2026-09-04 against the API in test mode:
//
//   queried with NO Stripe-Account header (the PLATFORM scope):
//       application_fee.created = 5   charge.refunded = 0
//   queried with `Stripe-Account: acct_1UC065FfnKu8VnLM` (a CONNECTED account):
//       application_fee.created = 0   charge.refunded = 2
//
// The `charge.refunded` row is the CONTROL that makes the zeros trustworthy:
// those two are the halves of the verified fee-refund rail run
// (docs/runbooks/verify-the-fee-refund-rail.md §5), and they are ABSENT from
// the platform scope — so the platform list demonstrably excludes
// connected-account events rather than being broken. All five fee events carry
// `account: null`.
//
// An ApplicationFee is a PLATFORM-owned object (lib/stripe-fee-refund.ts states
// this, and the refund rail depends on it), so `application_fee.created` can
// NEVER arrive at the `connect: true` endpoint that carries `charge.refunded`.
// It needs a second, ACCOUNT-scoped (non-Connect) endpoint at the SAME URL, and
// Stripe gives every endpoint its own `whsec_` — hence two secrets, one handler.
//
// AND STRIPE DOES NOT REFUSE THE WRONG CONFIGURATION: creating a `connect: true`
// endpoint whose `enabled_events` is `[application_fee.created]` returns HTTP 200
// and then simply never fires (probe created and deleted 2026-09-04). "No
// earnings recorded" would be indistinguishable from "no commission earned yet",
// which is the same silent shape as the fee-refund gap itself.
//
// Pure and clock-free, same discipline as lib/stripe-signature.ts, which this
// only ever calls: `nowSeconds` is passed in, never read here.
import { verifyStripeSignature } from "./stripe-signature";

/** Which Stripe endpoint a delivery came from. Named, not indexed, so a log
 *  line says WHICH secret was in play rather than "secret 0". */
export type WebhookScope = "connect" | "account";

export type WebhookSecret = { scope: WebhookScope; secret: string };

/**
 * The configured secrets, in the order they are tried.
 *
 * Trimmed and dropped when empty for the same reason `missingPairedStripeAccount`
 * tests more than truthiness: a box `.env` line left as `SECRET= ` yields `" "`,
 * which is truthy in JS and would make an unconfigured endpoint look configured —
 * it would answer 400 "invalid signature" instead of 503 "not configured", and
 * the runbook's step 2 uses exactly that distinction to prove the handler is set
 * up before spending a charge on it.
 *
 * Connect first because it is the older, busier scope; the order is otherwise
 * immaterial — a secret either verifies a given body or it does not.
 */
export function webhookSecrets(env: {
  connect: string | undefined;
  account: string | undefined;
}): WebhookSecret[] {
  const secrets: WebhookSecret[] = [];
  const connect = env.connect?.trim();
  const account = env.account?.trim();
  if (connect) secrets.push({ scope: "connect", secret: connect });
  if (account) secrets.push({ scope: "account", secret: account });
  return secrets;
}

/**
 * The scope whose secret verifies this delivery, or `null` when none does.
 *
 * EVERY configured secret is tried, not just the first: the two endpoints post
 * to the same URL and nothing in the request says which one sent it. Returning
 * the scope rather than a boolean is what lets the caller log a rejection
 * against the set of secrets that were actually in play, so "the account
 * endpoint's secret is wrong" is distinguishable from "we only have the Connect
 * one configured at all".
 */
export function verifyingScope(args: {
  rawBody: string;
  header: string;
  secrets: readonly WebhookSecret[];
  nowSeconds: number;
}): WebhookScope | null {
  for (const { scope, secret } of args.secrets) {
    if (verifyStripeSignature(args.rawBody, args.header, secret, args.nowSeconds)) return scope;
  }
  return null;
}
