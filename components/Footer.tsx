import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations("footer");

  // Locale-aware links ("/#anchor" + content pages) so the footer works from
  // every marketing page, not just the landing.
  return (
    <footer className="border-t-2 border-border">
      <div className="mx-auto max-w-6xl px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div>
          <p className="font-hand text-4xl font-bold text-primary">SofraPiwas</p>
          <p className="mt-1 font-label text-sm text-muted-foreground">
            {t("tagline")}
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 max-w-md font-label">
          <Link href="/#features" className="hover:text-primary transition-colors">
            {t("nav.features")}
          </Link>
          <Link href="/#showcase" className="hover:text-primary transition-colors">
            {t("nav.live")}
          </Link>
          <Link href="/#pricing" className="hover:text-primary transition-colors">
            {t("nav.pricing")}
          </Link>
          <Link href="/#faq" className="hover:text-primary transition-colors">
            {t("nav.faq")}
          </Link>
          <Link href="/#waitlist" className="hover:text-primary transition-colors">
            {t("nav.waitlist")}
          </Link>
          <Link href="/#partner" className="hover:text-primary transition-colors">
            {t("nav.partner")}
          </Link>
          <Link href="/case/rumi" className="hover:text-primary transition-colors">
            {t("nav.caseStudy")}
          </Link>
          <Link href="/compare/gloriafood" className="hover:text-primary transition-colors">
            {t("nav.compare")}
          </Link>
          <Link href="/changelog" className="hover:text-primary transition-colors">
            {t("nav.changelog")}
          </Link>
        </nav>

        <div className="text-sm text-muted-foreground">
          <p className="font-mono text-xs">{t("madeIn")} ✳</p>
          <p className="mt-1">{t("copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
