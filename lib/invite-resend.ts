// "Send me that invite again" — what a re-send DOES, per account state (G12).
//
// Pure, and separate from the server action for the reason this whole file family
// is split that way: the action talks to a database and a mail provider, while the
// rule it applies is the part that must be measurable — and the rule here is a
// SECURITY rule as much as a product one.
//
// THE PROPERTY THAT MATTERS: this function decides what to SEND, never what to
// ANSWER. The form answers the same generic sentence to every address, always, so
// it cannot be used to ask "does this restaurant have an account with you?" — the
// same posture as `forgotPasswordAction`. Keeping the two apart in code is what
// stops a later edit from helpfully surfacing "no account found".

/** The account states this rule can see. `null` = no such address. */
export type ResendSubject = { status: string } | null;

export type ResendPlan =
  /** Send nothing at all. */
  | { kind: "none" }
  /** Mint a fresh invite token and send the set-password link. */
  | { kind: "invite" }
  /** The account already has a password: send the plain login link instead. A
   *  set-password link here would invite someone to reset a password they know,
   *  which is how a working account becomes a support ticket. */
  | { kind: "login" };

/**
 * What a re-send should do for this account.
 *
 * `DISABLED` sends nothing, and that is the one branch worth stating twice: an
 * account we switched off must not be able to talk itself back into a live link,
 * exactly as `setPasswordAction` refuses a leftover token for one.
 *
 * An unknown status is treated as `login` rather than `invite`: handing out a
 * password-setting link is the more powerful of the two, so a status this rule has
 * never heard of gets the weaker one.
 */
export function resendPlan(user: ResendSubject): ResendPlan {
  if (!user) return { kind: "none" };
  if (user.status === "DISABLED") return { kind: "none" };
  if (user.status === "INVITED") return { kind: "invite" };
  return { kind: "login" };
}
