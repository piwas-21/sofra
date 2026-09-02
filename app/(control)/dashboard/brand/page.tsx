import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { prefillFromBillingIdentity } from "@/lib/partner-brand";
import PartnerBrandForm from "@/components/control/PartnerBrandForm";

/**
 * `/dashboard/brand` — the partner's own public details (SOFRA-PARTNER-PLAN §11).
 *
 * `requirePartner()`, not `requirePartnerOrOwner()`, for the reason
 * `/dashboard/domains` states: a direct restaurant owner has one tenant and it is
 * their own, so there is no third party for them to be credited as.
 *
 * Reads are scoped by `partner.id` on both queries — a partner can only ever load
 * their own brand and their own billing identity.
 *
 * Never cached: it renders a row the same request may have just written, and the
 * row is per-user.
 */
export const dynamic = "force-dynamic";

export default async function PartnerBrandPage() {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.brand" });

  const brand = await db.partnerBrand.findUnique({ where: { partnerId: partner.id } });

  // Only consulted when there is no brand yet, and only for a NAME. Looked up by
  // `userId` — the simple link, which is the right one here: this page is about a
  // PARTY, not about one plan, so the plan-scoped `resolveIdentityForPlan` would be
  // answering a question nobody asked. Nothing from this record is stored by
  // loading the page; the partner sees the value in an editable field and saves it
  // themselves (lib/partner-brand.ts explains why only this one field crosses).
  // Read whether or not there is a brand already, because it now answers TWO
  // questions and only the first is about prefilling. The second is D-B1a: a
  // display name that IS the legal name will not be published, so the form has to
  // know the legal name to be able to say so — and a partner whose record has no
  // TRADE name is the one who needs telling before they type, since the only other
  // name we hold is their own. Nothing from this record is stored by loading the
  // page, and none of it is rendered: `legalName` reaches the client as a
  // comparison input, which is a value the partner typed into their own billing
  // record and is being shown their own copy of.
  const identity = await db.billingIdentity.findUnique({
    where: { userId: partner.id },
    select: { legalName: true, tradeName: true },
  });
  const prefill = brand ? null : prefillFromBillingIdentity(identity);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
        <p className="mt-2 font-label text-sm text-muted-foreground">{t("privacyNote")}</p>
      </div>

      <section className="grid gap-4">
        {!brand && prefill && (
          <p className="font-label text-sm text-muted-foreground">{t("prefillNote")}</p>
        )}
        <PartnerBrandForm
          defaults={brand ?? prefill ?? undefined}
          legalName={identity?.legalName}
          hasTradeName={Boolean(identity?.tradeName?.trim())}
        />
      </section>
    </div>
  );
}
