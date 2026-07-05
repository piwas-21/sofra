import { useTranslations } from "next-intl";
import ThemeToggle from "./ThemeToggle";
import LocaleSwitcher from "./LocaleSwitcher";

export default function Header() {
  const t = useTranslations("header");

  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b-2 border-border">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <a href="#top" className="font-hand text-3xl font-bold text-primary">
          Sofra
        </a>

        <nav className="hidden md:flex items-center gap-8 font-label text-lg">
          <a href="#features" className="hover:text-primary transition-colors">
            {t("features")}
          </a>
          <a href="#showcase" className="hover:text-primary transition-colors">
            {t("live")}
          </a>
          <a href="#pricing" className="hover:text-primary transition-colors">
            {t("pricing")}
          </a>
          <a href="#partner" className="hover:text-primary transition-colors">
            {t("partner")}
          </a>
          <a
            href="#waitlist"
            className="btn-artisanal rounded-craft border-2 border-primary text-primary px-4 py-1.5"
          >
            {t("waitlist")}
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="/login"
            className="font-label text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {t("signIn")}
          </a>
          <LocaleSwitcher label={t("localeSwitcher")} />
          <ThemeToggle label={t("themeToggle")} />
        </div>
      </div>
    </header>
  );
}
