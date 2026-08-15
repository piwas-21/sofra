/**
 * What the signup form should say, decided from the POST's own answer
 * (EMAIL-SPEC-CONTROL-PLANE G5).
 *
 * Pulled out of the component because the interesting branch is the one nobody
 * can see: an account IS created and the welcome email is NOT sent, which is
 * exactly when the old copy ("check your email to set your password") sent the
 * customer to an inbox that would never receive anything. `sendEmail` reports
 * that as `{sent:false}` rather than throwing — a missing API key, an unset
 * sender, a Resend non-2xx — so the failure is data, and the UI has to read it.
 */
export type SignupStatus =
  | "success"
  | "successNoEmail"
  | "successLead"
  | "slugTaken"
  | "slugReserved"
  | "invalidSlug"
  | "error";

/**
 * Maps a response to a status, or null to let the caller fall back to its
 * generic handling. `body` is null when the response carried no JSON.
 */
export function interpretSignupResponse(
  status: number,
  body: Record<string, unknown> | null,
  ok: boolean,
): SignupStatus | null {
  if (status === 409) {
    // The server's `slugInvalid` maps to the client's own `invalidSlug` key —
    // unreachable from a browser (client validation catches it first), but a
    // name mismatch that silently collapsed to the generic error would be a trap
    // for whoever next changes either side.
    const reason = body?.reason;
    if (reason === "slugTaken" || reason === "slugReserved") return reason;
    return reason === "slugInvalid" ? "invalidSlug" : "error";
  }

  if (!ok || body?.ok !== true) return null;

  if (body.account !== true) return "successLead";

  // `emailed` is only ever absent on a response from an older deployment, and
  // the safe reading of "unknown" is the promise we can keep: an account exists
  // either way, and telling someone their email failed when it did not sends
  // them to support for nothing. Only an explicit false switches the copy.
  return body.emailed === false ? "successNoEmail" : "success";
}
