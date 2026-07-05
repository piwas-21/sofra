import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t-2 border-border">
      <div className="mx-auto max-w-6xl px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div>
          <p className="font-hand text-4xl font-bold text-primary">Sofra</p>
          <p className="mt-1 font-label text-sm text-muted-foreground">
            {t("tagline")}
          </p>
        </div>

        <nav className="flex gap-6 font-label">
          <a href="#features" className="hover:text-primary transition-colors">
            {t("nav.features")}
          </a>
          <a href="#showcase" className="hover:text-primary transition-colors">
            {t("nav.live")}
          </a>
          <a href="#pricing" className="hover:text-primary transition-colors">
            {t("nav.pricing")}
          </a>
          <a href="#waitlist" className="hover:text-primary transition-colors">
            {t("nav.waitlist")}
          </a>
        </nav>

        <div className="text-sm text-muted-foreground">
          <p className="font-mono text-xs">{t("madeIn")} ✳</p>
          <p className="mt-1">{t("copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
