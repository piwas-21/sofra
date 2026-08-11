"use client";

import { useTranslations } from "next-intl";

export type VatStatusValue = "NONE" | "UNCHECKED" | "VALID" | "INVALID" | "UNAVAILABLE";

/**
 * What VIES said about this party's VAT number, stated honestly.
 *
 * Three of the five states need care in the copy, because the obvious wording is
 * wrong in a way that costs someone time:
 *
 *  • UNAVAILABLE is **not** a rejection. VIES throttles hard, and telling a
 *    customer their number is invalid because a member state was busy sends them
 *    hunting for a mistake they have not made. It says "could not check", and
 *    offers to try again.
 *  • A VALID with no consultation reference is **not** fully proven. The
 *    reference is the audit evidence, and it only exists when the check
 *    identified us as requester (an unset SOFRA_VAT_NUMBER, say). Rendering that
 *    identically to an evidenced VALID would hide the one thing an auditor asks
 *    for, so it is called out rather than folded in.
 *  • `FORMAT_UNKNOWNCOUNTRY` means the number is not an EU VAT id at all — a
 *    Swiss or British registration is perfectly real and simply outside VIES.
 *    Saying "invalid" there would be untrue.
 */
export default function VatStatusBadge({
  status,
  checkedAt,
  evidenced,
  detail,
  registeredName,
}: Readonly<{
  status: VatStatusValue;
  checkedAt?: Date | null;
  evidenced?: boolean;
  detail?: string | null;
  registeredName?: string | null;
}>) {
  const t = useTranslations("control.admin.identity.vat");

  const tone: Record<VatStatusValue, string> = {
    VALID: "text-craft-success-text",
    INVALID: "text-craft-error-text",
    UNAVAILABLE: "text-muted-foreground",
    UNCHECKED: "text-muted-foreground",
    NONE: "text-muted-foreground",
  };

  // Not an EU number at all — a different thing from "we checked and it is bad".
  const notEu = status === "INVALID" && detail === "FORMAT_UNKNOWNCOUNTRY";
  const label = notEu ? t("notEu") : t(status);

  return (
    <span className="font-label text-sm">
      <span className={tone[status]}>{label}</span>
      {status === "VALID" && !evidenced && (
        <span className="ml-2 text-craft-error-text">{t("unevidenced")}</span>
      )}
      {status === "VALID" && registeredName && (
        <span className="ml-2 text-muted-foreground">{t("registeredAs", { registeredName })}</span>
      )}
      {checkedAt && (
        <span className="ml-2 text-muted-foreground">
          {t("checkedOn", { date: checkedAt.toISOString().slice(0, 10) })}
        </span>
      )}
    </span>
  );
}
