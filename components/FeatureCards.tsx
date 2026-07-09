import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";
import {
  QrIcon,
  BoardIcon,
  CalendarIcon,
  HeartIcon,
  PrinterIcon,
  GlobeIcon,
} from "./CraftIcons";

const items = [
  { key: "qr", Icon: QrIcon, tilt: "-rotate-1" },
  { key: "live", Icon: BoardIcon, tilt: "rotate-1" },
  { key: "reservations", Icon: CalendarIcon, tilt: "rotate-[-0.6deg]" },
  { key: "loyalty", Icon: HeartIcon, tilt: "rotate-[0.8deg]" },
  { key: "printing", Icon: PrinterIcon, tilt: "rotate-[0.5deg]" },
  { key: "languages", Icon: GlobeIcon, tilt: "rotate-[-0.9deg]" },
] as const;

export default function FeatureCards() {
  const t = useTranslations("features");

  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-craft-section-mobile md:py-craft-section">
      <SectionLabel>{t("label")}</SectionLabel>
      <h2 className="mt-4 font-display font-bold text-5xl md:text-6xl">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ key, Icon, tilt }) => (
          <article
            key={key}
            className={`hand-drawn-border bg-card p-6 ${tilt} transition-transform duration-200 hover:rotate-0 hover:-translate-y-1`}
          >
            <Icon className="h-12 w-12 text-primary" />
            <h3 className="mt-4 font-hand text-3xl font-bold">
              {t(`items.${key}.title`)}
            </h3>
            <p className="mt-2 text-muted-foreground leading-relaxed">
              {t(`items.${key}.text`)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
