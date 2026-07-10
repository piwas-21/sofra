import Link from "next/link";
import { Link as LocaleLink } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import ThemeToggle from "./ThemeToggle";
import LocaleSwitcher from "./LocaleSwitcher";

export default function Header() {
  const t = useTranslations("header");

  // Locale-aware "/#anchor" links so the header works from the content pages
  // (/changelog, /case/rumi, /compare/gloriafood) too, not just the landing.
  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xs border-b-2 border-border">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <LocaleLink href="/#top" className="font-hand text-3xl font-bold text-primary">
          Sofra
        </LocaleLink>

        <nav className="hidden md:flex items-center gap-8 font-label text-lg">
          <LocaleLink href="/#features" className="hover:text-primary transition-colors">
            {t("features")}
          </LocaleLink>
          <LocaleLink href="/#showcase" className="hover:text-primary transition-colors">
            {t("live")}
          </LocaleLink>
          <LocaleLink href="/#pricing" className="hover:text-primary transition-colors">
            {t("pricing")}
          </LocaleLink>
          <LocaleLink href="/#partner" className="hover:text-primary transition-colors">
            {t("partner")}
          </LocaleLink>
          <LocaleLink
            href="/#waitlist"
            className="btn-artisanal rounded-craft border-2 border-primary text-primary px-4 py-1.5"
          >
            {t("waitlist")}
          </LocaleLink>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="font-label text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {t("signIn")}
          </Link>
          <LocaleSwitcher label={t("localeSwitcher")} />
          <ThemeToggle label={t("themeToggle")} />
        </div>
      </div>
    </header>
  );
}
