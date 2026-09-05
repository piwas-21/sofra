// Errors the registry commission editor can raise. Their own module because
// `lib/registry-commission-pr.ts` and `lib/actions/provisioning-actions.ts` both
// discriminate on them, and because lifting them here is what keeps the editor
// itself under the §4 length limit without compressing the comments that explain
// WHY each refusal exists.

export class UnknownRegistryTenantError extends Error {
  constructor(slug: string) {
    super(`registry has no '${slug}' entry`);
    this.name = "UnknownRegistryTenantError";
  }
}

/** `bps` failed `isCommissionBps` — negative, fractional, or above the ceiling. */
export class InvalidCommissionBpsError extends Error {
  constructor(bps: number) {
    super(`${bps} is not a valid commission rate`);
    this.name = "InvalidCommissionBpsError";
  }
}

/**
 * A non-zero rate was requested for a tenant whose block has no
 * `stripe_account:` line. `provision-tenant.sh` refuses a non-zero
 * `payments_commission_bps` unless the SAME entry also carries
 * `online-payments` in `modules` AND a `stripe_account` — and refuses it
 * BEFORE the database, the compose project or the image. So writing the rate
 * here without the account would not give this tenant a restaurant without
 * commission on the next re-provision; it would give them no tenant at all.
 *
 * Unlike a brand-new entry (`splitDeferredModules` in
 * `provisioning-module-pairing.ts`), there is no "defer it to a second PR"
 * available here: this call amends a tenant that already exists, so the only
 * honest answer is to refuse outright rather than propose a change that would
 * brick the next re-provision.
 */
export class MissingStripeAccountError extends Error {
  constructor(slug: string) {
    super(
      `'${slug}' has no stripe_account: — provision-tenant.sh refuses a non-zero ` +
        "payments_commission_bps without online-payments + stripe_account, and refuses it " +
        "BEFORE the database, so proposing this rate would yield no tenant at all rather " +
        "than a tenant without commission",
    );
    this.name = "MissingStripeAccountError";
  }
}
