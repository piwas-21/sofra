import { Link } from "@/i18n/navigation";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import JsonLdScript from "@/components/JsonLdScript";
import SectionLabel from "@/components/SectionLabel";
import { SITE_URL } from "@/lib/seo";
import { DISCOVERY_CONTENT_LAST_CHECKED } from "@/components/discovery-guide-data";

type RelatedGuidePath = "/compare/alternatives" | "/guides/qr-menu-switzerland" | "/guides/qr-menu-geneva" | "/case/rumi";

interface GuideStep {
  key: string;
  title: string;
  body: string;
}

interface GuideSource {
  key: string;
  label: string;
  url: string;
}

interface DiscoveryGuidePageProps {
  locale: string;
  path: string;
  metaTitle: string;
  metaDescription: string;
  label: string;
  title: string;
  subtitle: string;
  checked: string;
  intro: string;
  stepsTitle: string;
  steps: GuideStep[];
  fieldCheck: { title: string; body: string; link?: { href: RelatedGuidePath; label: string } };
  sourcesTitle: string;
  sourcesNote: string;
  sources: GuideSource[];
  relatedLabel: string;
  related: { href: RelatedGuidePath; label: string }[];
}

/** Shared presentation for the localized, source-dated Switzerland and Geneva guides. */
export default function DiscoveryGuidePage({
  locale,
  path,
  metaTitle,
  metaDescription,
  label,
  title,
  subtitle,
  checked,
  intro,
  stepsTitle,
  steps,
  fieldCheck,
  sourcesTitle,
  sourcesNote,
  sources,
  relatedLabel,
  related,
}: Readonly<DiscoveryGuidePageProps>) {
  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": SITE_URL + "/" + locale + path,
    name: metaTitle,
    description: metaDescription,
    inLanguage: locale,
    dateModified: DISCOVERY_CONTENT_LAST_CHECKED,
    isPartOf: { "@id": SITE_URL + "/#website" },
  };

  return (
    <>
      <JsonLdScript data={[webPage]} />
      <Header />
      <main>
        <article className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
          <SectionLabel>{label}</SectionLabel>
          <h1 className="mt-4 font-display font-bold text-5xl md:text-6xl">{title}</h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">{subtitle}</p>
          <p className="mt-4 font-mono text-xs text-primary">
            <time dateTime={DISCOVERY_CONTENT_LAST_CHECKED}>{checked}</time>
          </p>
          <p className="mt-8 text-muted-foreground leading-relaxed">{intro}</p>
          <h2 className="mt-10 font-hand text-3xl font-bold">{stepsTitle}</h2>
          <ol className="mt-4 space-y-5">
            {steps.map((step, index) => (
              <li key={step.key} className="hand-drawn-border bg-card p-5">
                <span className="font-mono text-xs text-primary">{index + 1}</span>
                <h3 className="mt-2 font-label text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-muted-foreground leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
          <aside className="mt-10 hand-drawn-border bg-muted/40 p-6">
            <h2 className="font-hand text-2xl font-bold">{fieldCheck.title}</h2>
            <p className="mt-2 text-muted-foreground leading-relaxed">{fieldCheck.body}</p>
            {fieldCheck.link && (
              <Link href={fieldCheck.link.href} className="mt-4 inline-block underline decoration-primary/60 underline-offset-4">
                {fieldCheck.link.label}
              </Link>
            )}
          </aside>
          <section className="mt-12">
            <h2 className="font-hand text-3xl font-bold">{sourcesTitle}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{sourcesNote}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {sources.map((source) => (
                <li key={source.key}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-primary/60 underline-offset-4 hover:text-primary">
                    {source.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <nav aria-label={relatedLabel} className="mt-12 flex flex-wrap gap-x-6 gap-y-3">
            {related.map((link) => (
              <Link key={link.href} href={link.href} className="underline decoration-primary/60 underline-offset-4">
                {link.label}
              </Link>
            ))}
          </nav>
        </article>
      </main>
      <Footer />
    </>
  );
}
