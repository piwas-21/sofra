# ADR-011 — Payments split: Mollie for Sofra billing, Stripe Connect for tenant payments

**Status:** accepted 2026-07-05 (owner decision); **amended 2026-09-04** — Job B
gains the application-fee mechanism, still defaulting to 0 for every tenant;
**amended 2026-09-05** — the implementation moves to **Express** connected
accounts minted by the control plane, which is what Job B always said. See the
two §Amendment sections, in that order.

Two distinct payment jobs, two providers:

## Job A — Sofra bills its tenants (subscriptions, CHF/EUR)

**Mollie** (amends ADR-005). Profile for sofrapiwas.com submitted 2026-07-05,
awaiting approval + API keys. Port domainio's webhook-verification + invoice
patterns; **recurring (customers + mandates + subscriptions) is net-new** —
domainio has no subscription code. Module/bundle prices (ADR-010) and
path-3 domain fees (ADR-002) ride the same subscription/invoice.

## Job B — Tenants charge their end customers (online orders)

**Stripe Connect**, when the online-payments module is scheduled: each
restaurant becomes a connected account (Express onboarding), Sofra takes an
application fee per transaction. Chosen over Mollie-for-Platforms for platform
maturity, Swiss-merchant + TWINT coverage, and worldwide headroom as markets
expand beyond CH/NL/FR.

## Amendment (2026-09-04) — the commission mechanism exists now; the rate is still zero

Job B said "Sofra takes an application fee per transaction." It never shipped one:
v1 is Direct charges with `application_fee_amount` deliberately unset
(`IStripeGateway.BuildRequestOptions` docstring, backend — *"Sofra takes no
commission and the money never touches its balance"*). This amendment adds the
mechanism. **It does not turn it on for anyone.**

**The mechanism.** `application_fee_amount` on the existing Connect **Standard
direct charge** — charge type, connected account, onboarding and settlement are
all unchanged. Money still never passes through Sofra's balance; Stripe transfers
the fee to the platform after the charge settles on the connected account.

**Configuration.** Backend setting `Stripe:Commission:Bps` (basis points),
overridden per tenant via the deploy registry key `payments_commission_bps`.
**Default 0.** Putting a tenant on a rate is a registry edit, not a deploy.

**Measured 2026-09-04**, platform `acct_1TpwTNCAHTt6eZ8i` (NL) against a
throwaway CH connected account, Stripe test mode:

- An NL platform **can** collect an application fee from a CH connected account —
  a real `ApplicationFee` object was produced. Stripe's docs only say fees work in
  "most countries with a few exceptions based on the country pair"; NL→CH is not
  one of the exceptions.
- The fee arrives **in CHF**, so the EUR-booked NL platform accrues a CHF
  balance. FX applies on conversion.
- **An oversized fee is CAPPED, not rejected.** A requested fee of 5000 on a
  4000 charge produced an `ApplicationFee` of 4000 with no error — Stripe took
  the whole order rather than refuse the request. Hence the backend enforces its
  own ceiling of **1000 bps (10%)**; nothing upstream will stop a misconfigured
  value above that.
- `POST /v1/checkout/sessions` validates the fee **not at all** — it accepted a
  fee larger than the order, and accepted a session on an account with
  `charges_enabled: false`. Only confirming a PaymentIntent discriminates.

**Two consequences, recorded as open — not solved by this change:**

1. **Refunds.** Stripe does not auto-refund the application fee when a charge is
   refunded; the platform must pass `refund_application_fee=true` or the
   connected account eats the fee. RUMI today deliberately refuses to refund
   Stripe-captured payments (`TenderCustody` — the platform key has no refunds
   write), so the restaurant refunds from its own Stripe dashboard and nothing
   returns the fee. **A non-zero rate must not be switched on for any tenant
   until this is closed.** The intended fix is a platform-level Connect webhook
   (`connect: true`) on `charge.refunded`, which IS permitted — unlike
   registering a webhook on a connected account.
2. **No commission reporting surface.** Fees accrue in the platform's own
   Stripe balance; nothing in the control plane reports them per tenant.
   `CommissionEntry` is the **partner** ledger (ADR-009) and must not be
   overloaded for this — different entity, different money, different source
   of truth.

**What this amendment does not touch:** no tenant's rate, the module's price, or
its marketing copy. `online-payments`' "no commission" promise — the payments
FAQ answer (`faq.items.payments.a`) and the competitor-comparison row
(`compare.table.rows.payments.sofra`), twice per locale across `en de nl fr tr
ar` (twelve strings, verified by grep 2026-09-04) — is still **true**, because
every tenant is at 0. That copy is exactly what must change, in all twelve
places, the day a tenant is first put on a non-zero rate — and not before.

## Amendment (2026-09-05) — the implementation moves to Express, which is what this ADR always said

Job B said each restaurant becomes a connected account via **Express onboarding**. The implementation shipped
**Standard** direct charges instead, and the 2026-09-04 amendment above recorded that as the mechanism. This
amendment closes the drift in the ADR's favour: **new tenants get Express connected accounts, minted by the
control plane.** Nothing about the charge type changes — still Direct charges with `application_fee_amount`,
still money that never touches Sofra's balance.

**Migration cost is zero, and that is why now.** No tenant has a `stripe_account` today: all six mentions in
`deploy/tenants/registry.yml` are comment lines (`grep -n "^ *stripe_account:"` returns nothing, exit 1, while
the same-shaped `grep -c "^ *modules:"` on the same file returns 6, which is the control that makes the zero
believable). There is no account to migrate, and an account's type cannot be changed after creation.

**Measured 2026-09-05**, platform `acct_1TpwTNCAHTt6eZ8i` (NL), Stripe **test** mode, against CH Express
connected accounts created and then deleted (`GET` on each afterwards returns 403; `GET /v1/accounts?limit=20`
lists only the two pre-existing accounts):

- **TWINT works on CH Express, and our automation is the right mechanism.** `twint_payments` is requestable at
  create time alongside `card_payments` + `transfers`; its only blocker is `requirements.fields_needed`. An
  Express account carries the same **two** payment-method configurations as a Standard one — exactly one with
  `parent: null` — and `POST /v1/payment_method_configurations/{id} twint[display_preference][preference]=on`
  returns `available: true`. **`provision-tenant.sh:1001-1058` needs no change.** Stripe's TWINT page confirms
  the direction: for Express-dashboard accounts, enabling TWINT is the *platform's* job. This closes this
  ADR's open "TWINT availability matrix / Connect Express in CH" item.
- **The platform still cannot accept ToS**, and Express does not change that: `POST /v1/accounts/{id}
  tos_acceptance[...]` → `400 "You cannot accept the Terms of Service on behalf of accounts where
  controller[requirement_collection]=stripe, which includes Standard and Express accounts."` BACKLOG's
  wording ("a **Standard** account") was too narrow and is corrected, not removed.
- **Prefill is real, and it is create-only.** A bare CH Express account has **16** `currently_due` fields;
  created with name, address, email, MCC, URL and the restaurant's **IBAN** as `external_account`, it has
  **6**: `individual.dob.{day,month,year}`, `individual.phone`, `tos_acceptance.{date,ip}`. The same fields
  are refused on **update** (`403 oauth_not_supported`), so the mint call is the only chance to prefill. This
  is the answer to "can we just collect the IBAN": yes — and the restaurant still spends about two minutes in
  Stripe's hosted form, which cannot be removed.
- **An address is not a neutral prefill.** `individual[...]` without `business_type` is a hard `400`, and
  `business_type` is itself refused on update — so prefilling an address *commits* the account to a natural
  person, uncorrectably, for a restaurant that may turn out to be a company. Without that knowledge the
  implementation sends neither and accepts **13** `currently_due` instead of 6. Thirteen beats wrong.
- **The commission mechanism survives untouched.** On an Express account, `POST /v1/payment_intents` with
  `application_fee_amount` and `POST /v1/checkout/sessions` with
  `payment_intent_data[application_fee_amount]` both return **200**; only confirming the intent discriminates
  (*"Your account cannot currently make charges"*). Identical to the 2026-09-04 finding.
  `IStripeGateway.BuildRequestOptions` and `StripeCheckoutClient` change **not at all**, and neither do the
  four `provision-tenant.sh` guards or either Prisma fee table.
- **Correction to the 2026-09-04 amendment above.** It describes the mechanism as "the existing Connect
  **Standard** direct charge". The account that measurement ran against, `acct_1UC065FfnKu8VnLM`, is
  `type: none` with `controller.losses.payments = application` and
  `controller.requirement_collection = application` — **the same loss model as Express, and not Standard at
  all.** The NL→CH application fee was therefore already proven on a platform-loss-liable account.

**Account Links have a 300-second fuse.** `POST /v1/account_links` returns `expires_at = created + 300`, two
calls return two different URLs, `type=account_update` is refused on Express (*"Valid types for this account
are `["account_onboarding"]`"*), and a login link is refused until onboarding completes. So the restaurant is
sent a page of **ours** that mints a link per click — never a Stripe URL, which would be dead before the email
was read.

**What Express costs, recorded as accepted:** `controller.losses.payments = "application"`. Stripe debits the
connected account and its external account first; if that fails the loss is the platform's, Stripe holds a
reserve in our balance meanwhile, and after 180 days it takes the reserve. Managed Risk is unavailable to
loss-liable platforms, so fraud vetting at signup is ours. Dispute *fees* still fall on the connected account.
The mitigation we gain: the platform can set `settings.payouts.schedule` (`delay_days`, `interval: manual`)
and should leave `debit_negative_balances` at its Express default of `true`.

**Owner-side prerequisites, neither of which is code:** the Connect platform profile must be complete, and
**Express onboarding must be enabled for Switzerland** in the Dashboard's Connect Settings — Stripe enables it
per country, and our platform is NL while our tenants are CH. A third is a key scope: the control plane's
`STRIPE_API_KEY` needs `Connect → write`, and the **box** key must never get it.

**Not verified, and not to be published as fact until the first live tenant:** that `twint_payments` reaches
`active` on an Express account (activation needs ToS, which needs the hosted flow); Express fee rates for CH
(Stripe exposes no fee-schedule endpoint); and whether `DELETE /v1/accounts/{id}` succeeds on a **livemode**
Express account. On that last one the runbook's "one-way door" refusal is explicitly conditioned on
`controller[losses][payments]=stripe` **and** `controller[stripe_dashboard][type]=full`, neither of which
Express has, and the delete **did** succeed in test mode — so the door probably reopens. Re-measure in
`piwas sandbox` before rewriting that box.

**Where it shipped:** sofra #227 (persistence + slug-derived idempotency key), #228 (the mint), #229 (the
provenance flip — `stripe_account:` is server-derived, one registry PR carries both halves), #230
(`/onboarding/payments/<token>`), #231 (control-plane copy), #232 (the `account.updated` branch), #233
(`payments_link_url:` in the entry); frontend #726 and backend #493 for the tenant-facing copy and the
`paymentsLinkUrl` contract.

## Why split rather than one provider

- Sofra-the-merchant is EU/NL-anchored — Mollie's home turf, cheapest
  iDEAL/SEPA rates, profile already in progress.
- The restaurants are CH-first — TWINT is table stakes there, and Stripe's
  connected-account tooling (onboarding, KYC, payouts, application fees) is
  the most mature option and scales to "maybe worldwide".
- The two jobs share no code path; splitting costs no integration duplication.

## Verify at implementation (facts not re-confirmed on 2026-07-05 —
research was cut short; do NOT publish these as claims before checking)

- Mollie: Swiss **sub-merchant**/platform coverage; current TWINT status.
- ~~Stripe: TWINT availability matrix (merchant countries), Connect Express in CH.~~ **CLOSED 2026-09-05** by
  the Express amendment — measured on a CH Express account, including the per-account TWINT flip.
- Current fee tables for both (EU cards, TWINT, iDEAL) — feeds ADR-010 pricing.
