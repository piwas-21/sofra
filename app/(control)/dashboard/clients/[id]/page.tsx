import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePartner } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { clientTenantView } from "@/lib/client-tenant";
import ClientForm from "@/components/control/ClientForm";
import ClientStatusBadge from "@/components/control/ClientStatusBadge";
import ClientPipelineControls from "@/components/control/ClientPipelineControls";
import { verifiedBaseDomains } from "@/lib/partner-domain-access";
import { suggestSlug } from "@/lib/slug-availability";
import ClientTenantPanel from "@/components/control/ClientTenantPanel";
import ClientDomainChooser from "@/components/control/ClientDomainChooser";
import TenantDnsPanel from "@/components/control/TenantDnsPanel";
import { tenantDnsRecords } from "@/lib/tenant-dns-record";
import { checkDnsRecord } from "@/lib/tenant-dns-check";
import ClientPlanPanel from "@/components/control/ClientPlanPanel";
import ClientChangeRequestForm from "@/components/control/ClientChangeRequestForm";
import NoteForm from "@/components/control/NoteForm";

// The registry file changes underneath us (rsync on deploy-repo push), so this page
// must never be served from a build-time snapshot — same reason as /admin/tenants.
export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const partner = await requirePartner();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.client" });
  const td = await getTranslations({ locale, namespace: "control.domainChoice" });
  const { id } = await params;
  // Scoped by partnerId, as every partner read is (SOFRA-PARTNER-PLAN §5). The plan
  // rides the client relation, so it cannot be reached for a client they don't own.
  const client = await db.client.findFirst({
    where: { id, partnerId: partner.id },
    include: {
      clientNotes: { orderBy: { createdAt: "desc" }, include: { author: true } },
      billing: {
        include: {
          billingIdentity: true,
          subscriptions: { orderBy: { createdAt: "desc" } },
          // FIRST payments only, bounded: `planState` reads exactly this window, and
          // widening it would eventually push the `first` payment out and show a pay
          // button to somebody who has already paid.
          payments: { where: { sequenceType: "first" }, orderBy: { createdAt: "desc" }, take: 20 },
        },
      },
    },
  });
  if (!client) notFound();

  // Only fetched when the chooser will actually render — a live client's page must not
  // pay a query for a control it does not show.
  const baseDomains = client.tenantSlug ? [] : await verifiedBaseDomains(partner.id);

  const registry = await loadTenantRegistry();
  const view = clientTenantView({
    status: client.status,
    tenantSlug: client.tenantSlug,
    registry,
  });
  // What DNS this tenant's addresses still depend on, and whether it is published.
  // Only for a LIVE entry: every other branch has no registry entry to read, and a
  // tenant on our own base domain yields an empty list and renders nothing. The
  // lookups are bounded (3s, 2 tries each) and fail SOFT — a resolver hiccup shows
  // "we could not check", never "your record is missing".
  const dnsRows =
    view.kind === "live"
      ? await Promise.all(
          tenantDnsRecords(view.tenant).map(async (record) => ({
            record,
            state: await checkDnsRecord(record.host, process.env.TENANT_BOX_IP),
          })),
        )
      : [];

  // `resolveIdentityForPlan` resolves the payer through `client.partnerId`; the
  // relation is re-attached here rather than re-queried, because the plan's client is
  // the row we just loaded.
  const billing = client.billing
    ? { ...client.billing, client: { partnerId: client.partnerId } }
    : null;

  return (
    <div className="grid gap-10">
      <div>
        <Link href="/dashboard" className="font-label text-sm text-muted-foreground underline">
          {t("back")}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <h1 className="font-display font-bold text-5xl">{client.restaurantName}</h1>
          <ClientStatusBadge status={client.status} />
          {client.tenantSlug && (
            <code className="font-mono text-xs bg-muted/60 rounded-craft px-2 py-1">
              {client.tenantSlug}
            </code>
          )}
        </div>
      </div>

      <ClientTenantPanel locale={locale} view={view} />

      {/* The record the partner has to publish, for as long as the tenant exists.
          It used to appear only as the transient answer to the chooser below, which
          a reload erased and provisioning hid for good — so a partner whose client
          could not get a certificate had no way to find out why. */}
      <TenantDnsPanel locale={locale} rows={dnsRows} boxIp={process.env.TENANT_BOX_IP} />

      {/* Before a tenant exists, the partner gets to say where it should live (D2).
          After it exists this disappears on purpose: the domain is baked into a
          per-domain image, so changing it is a rebuild plus a re-provision — a
          conversation for the change-request form, not a chooser. Only VERIFIED base
          domains are offered, and the action re-reads and re-checks the proof anyway. */}
      {!client.tenantSlug && (
        <section className="hand-drawn-border bg-card p-6">
          <h2 className="font-hand text-3xl font-bold">{td("title")}</h2>
          <p className="mt-2 font-label text-muted-foreground">{td("intro")}</p>
          <div className="mt-4">
            <ClientDomainChooser
              clientId={client.id}
              suggestedSlug={suggestSlug(client.restaurantName)}
              baseDomains={baseDomains.map((d) => ({ id: d.id, domain: d.domain }))}
              // Env, not a constant: the box IP is deployment configuration, and a
              // hardcoded one would be wrong the day the box moves. Unset renders as
              // "we will send you the address" rather than a plausible placeholder.
              boxIp={process.env.TENANT_BOX_IP}
            />
          </div>
        </section>
      )}

      {view.kind !== "none" && (
        <>
          <ClientPlanPanel locale={locale} billing={billing} />
          <section className="hand-drawn-border bg-card p-6">
            <h2 className="font-hand text-3xl font-bold">{t("changeRequest")}</h2>
            <p className="mt-2 font-label text-muted-foreground">{t("changeRequestIntro")}</p>
            <div className="mt-4">
              {/* Deliberately NOT keyed by the note count like `NoteForm` below: the
                  remount would discard the "sent" acknowledgement it just earned. */}
              <ClientChangeRequestForm clientId={client.id} />
            </div>
          </section>
        </>
      )}

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">{t("pipeline")}</h2>
        <div className="mt-4">
          <ClientPipelineControls clientId={client.id} status={client.status} />
        </div>
      </section>

      <section className="hand-drawn-border bg-card p-6">
        <h2 className="font-hand text-3xl font-bold">{t("details")}</h2>
        <div className="mt-4">
          <ClientForm client={client} />
        </div>
      </section>

      <section className="ruled-lines hand-drawn-border bg-muted/40 p-6">
        <h2 className="font-hand text-3xl font-bold">{t("notes")}</h2>
        <div className="mt-4">
          {/* Keyed by note count: a successful add re-mounts the form empty */}
          <NoteForm key={client.clientNotes.length} clientId={client.id} />
        </div>
        <ul className="mt-6 grid gap-4">
          {client.clientNotes.map((n) => (
            <li key={n.id} className="bg-card rounded-craft border-2 border-border p-4">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-2 font-label text-xs text-muted-foreground">
                {n.author.name} · {shortDate(n.createdAt)}
              </p>
            </li>
          ))}
          {client.clientNotes.length === 0 && (
            <li className="font-label text-muted-foreground">{t("noNotes")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
