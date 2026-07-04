import { useTranslations } from "next-intl";
import WatercolourBlob from "./WatercolourBlob";

export default function Hero() {
  const t = useTranslations("hero");

  return (
    <section id="top" className="relative overflow-hidden">
      {/* Watercolour wash — top right, asymmetric */}
      <WatercolourBlob className="pointer-events-none absolute -top-24 -right-32 w-[34rem] md:w-[44rem] craft-glow animate-float" />

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 md:pt-28 md:pb-32">
        <span className="stamp inline-block font-mono text-xs text-primary px-3 py-1.5 mb-8 animate-fade-in">
          {t("stamp")}
        </span>

        <h1 className="font-display font-bold leading-[0.95] text-6xl md:text-8xl max-w-3xl animate-rise-in">
          {t("titleLine1")}
          <br />
          <span className="text-primary scribble-underline">{t("titleLine2")}</span>
        </h1>

        <p
          className="mt-8 max-w-xl text-lg md:text-xl text-muted-foreground animate-rise-in"
          style={{ animationDelay: "120ms" }}
        >
          {t("subtitle")}
        </p>

        <p
          className="mt-4 font-hand text-2xl text-craft-olive-text dark:text-craft-olive-dark animate-rise-in"
          style={{ animationDelay: "200ms" }}
        >
          {t("note")}
        </p>

        <div
          className="mt-10 flex flex-wrap items-center gap-4 animate-rise-in"
          style={{ animationDelay: "280ms" }}
        >
          <a href="#waitlist" className="btn-primary">
            {t("ctaPrimary")}
          </a>
          <a href="#features" className="btn-secondary">
            {t("ctaSecondary")}
          </a>
        </div>

        {/* Proof line — tenant 1, on a paper scrap */}
        <div
          className="mt-16 max-w-md hand-drawn-border bg-card px-5 py-4 rotate-[-0.8deg] animate-rise-in"
          style={{ animationDelay: "360ms" }}
        >
          <p className="font-label text-sm leading-relaxed text-muted-foreground">
            <span className="text-craft-success-text dark:text-craft-success font-bold">● </span>
            {t("proof")}
          </p>
        </div>
      </div>
    </section>
  );
}
