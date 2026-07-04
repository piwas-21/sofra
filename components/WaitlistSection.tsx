import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";
import WaitlistForm from "./WaitlistForm";

export default function WaitlistSection() {
  const t = useTranslations("waitlist");

  return (
    <section id="waitlist" className="bg-muted/40 torn-edge">
      <div className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
        <SectionLabel>{t("label")}</SectionLabel>
        <h2 className="mt-4 font-display font-bold text-5xl md:text-6xl">
          {t("title")}
        </h2>
        <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-10">
          <WaitlistForm />
        </div>
      </div>
    </section>
  );
}
