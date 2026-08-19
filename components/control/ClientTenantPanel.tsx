import { getTranslations } from "next-intl/server";
import { tenantOrigin } from "@/lib/tenant-liveness";
import { languageLabels, moduleLines, type ClientTenantView } from "@/lib/client-tenant";

/**
 * The tenant a partner sold, on the partner's own client page (SOFRA-PARTNER-PLAN §9).
 *
 * The founder's verdict on 2026-08-19, with a real reseller sitting next to him and his
 * first client LIVE: *"nothing is manageable from the partner page."* It was accurate.
 * Past ONBOARDING the pipeline control locks itself (the founder owns the status from
 * there), and what remained was an edit form and a notes box — no slug, no URL, no
 * modules, no plan, no next action. The person who owns the commercial relationship
 * could not see the product they had sold.
 *
 * Everything here is READ-ONLY and comes from the registry, which stays founder-run
 * (ADR-003/007). A partner asks for changes through the request form below the panel;
 * they never write a module, a domain or a status from this app.
 *
 * The three non-live branches are the point as much as the live one: an ONBOARDING
 * client with no entry yet, a registry we could not read, and a slug with no entry each
 * get a sentence. An empty panel is what this replaces.
 */
export default async function ClientTenantPanel({
  locale,
  view,
}: {
  readonly locale: string;
  readonly view: ClientTenantView;
}) {
  const t = await getTranslations({ locale, namespace: "control.tenant" });
  if (view.kind === "none") return null;

  if (view.kind !== "live") {
    // "We are setting it up", "we cannot look right now", "it is not in there yet".
    // The unreadable branch carries no error text on purpose — it is our mount or our
    // YAML, the partner cannot act on either, and /admin/tenants already says it loudly
    // to the person who can.
    return (
      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">{t("title")}</h2>
        <p className="mt-3 font-hand text-2xl">{t(`${view.kind}Title`)}</p>
        <p className="mt-1 font-label text-muted-foreground">{t(`${view.kind}Body`)}</p>
        {view.kind !== "awaiting" && (
          <p className="mt-3 font-label text-sm text-muted-foreground">
            {t("slugLine")}{" "}
            <code className="font-mono text-xs bg-muted/60 rounded-craft px-2 py-1">
              {view.slug}
            </code>
          </p>
        )}
      </section>
    );
  }

  const { tenant } = view;
  // `tenantOrigin` refuses anything that is not a bare host, so a hand-edited registry
  // entry cannot turn this into a link pointing somewhere unintended. No link is better
  // than a wrong one; the domain is still printed as text.
  const origin = tenantOrigin(tenant.domain);
  const modules = moduleLines(tenant.modules);
  const languages = languageLabels(tenant.languages);
  const templateKey = `template.${tenant.template ?? "classic"}`;

  return (
    <section className="hand-drawn-border bg-card p-6 grid gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-hand text-3xl font-bold">{t("title")}</h2>
        <span className="font-label text-sm text-muted-foreground">
          {t("statusLine", { status: tenant.status })}
        </span>
      </div>

      <div>
        {origin ? (
          <a
            href={origin}
            target="_blank"
            rel="noopener noreferrer"
            className="font-hand text-2xl font-bold underline underline-offset-4"
          >
            {tenant.domain}
          </a>
        ) : (
          <span className="font-hand text-2xl font-bold">{tenant.domain}</span>
        )}
        <p className="mt-1 font-label text-sm text-muted-foreground">{t("domainHint")}</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t("templateLabel")}
          </dt>
          <dd className="font-label">
            {t.has(templateKey) ? t(templateKey) : (tenant.template ?? "classic")}
          </dd>
        </div>
        <div>
          <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t("languagesLabel")}
          </dt>
          <dd className="font-label">{languages.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
            {t("currencyLabel")}
          </dt>
          <dd className="font-label">{tenant.currency ?? "EUR"}</dd>
        </div>
      </dl>

      <div>
        <h3 className="font-label text-xs uppercase tracking-[0.15em] text-muted-foreground">
          {t("modulesLabel")}
        </h3>
        <ul className="mt-2 grid gap-2">
          {modules.map((m) => (
            <li key={m.id} className="rounded-craft border-2 border-border p-3">
              {/* A module the catalog does not know is still GRANTED — the registry is
                  the source of truth and hiding it would under-report what this client
                  has. It renders as the raw id it is rather than as an invented name. */}
              <span className="font-bold">
                {m.known && t.has(`module.${m.id}`) ? t(`module.${m.id}`) : m.id}
              </span>
              <span className="block font-label text-sm text-muted-foreground">
                {m.known && t.has(`moduleSurface.${m.id}`)
                  ? t(`moduleSurface.${m.id}`)
                  : (m.surface ?? t("moduleUnknown"))}
              </span>
            </li>
          ))}
          {modules.length === 0 && (
            <li className="font-label text-muted-foreground">{t("noModules")}</li>
          )}
        </ul>
      </div>

      <p className="font-label text-sm text-muted-foreground">{t("registryNote")}</p>
    </section>
  );
}
