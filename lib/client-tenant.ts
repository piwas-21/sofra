// What a PARTNER may see about a client that has become a TENANT.
//
// A reseller's client and the thing they sold are two different records joined by one
// string: the CRM row (`Client`, this app's DB) and the registry entry (the deploy
// repo's `tenants/registry.yml`, ADR-003/007), joined by `Client.tenantSlug`. Until
// this module existed nothing on the PARTNER side crossed that join — so the moment a
// client reached ONBOARDING/LIVE their detail page became a dead pipeline control, an
// edit form and a notes box, and the person who had just sold the thing could not see
// that it existed, what it included, or what it cost.
//
// Pure by design — no DB, no network, no env — so every "what should this partner be
// told" decision below is unit-testable and identical on the row and on the panel.
// The registry read itself (`loadTenantRegistry`) and the plan query stay with their
// callers; this file only judges what they came back with.
//
// It is NOT an authorization boundary. Callers guard with `requirePartner()` and load
// the client scoped by `partnerId` first; nothing here can tell whose client it is.

import { MODULES } from "@/lib/module-catalog";
import { TENANT_LANGUAGES } from "@/lib/tenant-options";
import { planState, type PlanState } from "@/lib/billing-display";
import type { RegistryResult, RegistryTenant } from "@/lib/tenant-registry";

/**
 * Which tenant story this client is in.
 *
 * Every branch except `live` is a state the partner is entitled to a SENTENCE about —
 * the failure this replaces was an empty panel, and an empty panel reads as "the
 * product forgot about you" rather than as "nothing has happened yet".
 */
export type ClientTenantView =
  /** Still in the pipeline: nothing was ordered, so there is nothing to show. */
  | { kind: "none" }
  /** Onboarding requested, no slug yet — SofraPiwas has it and is provisioning. */
  | { kind: "awaiting" }
  /** A slug is recorded but the registry could not be read at all (an OPS condition). */
  | { kind: "unreadable"; slug: string }
  /** A slug is recorded and the registry has no entry for it yet. */
  | { kind: "unlisted"; slug: string }
  /** Provisioned: the registry entry is the answer to every question on the panel. */
  | { kind: "live"; slug: string; tenant: RegistryTenant };

/**
 * `Client` + registry → what to render.
 *
 * The registry-unreadable branch deliberately carries NO error text. It is our mount
 * or our YAML, the partner cannot act on either, and the founder already gets the
 * message loudly on /admin/tenants — the same fail-quiet direction `registryDomains`
 * takes on the owner dashboard. It stays a distinct branch rather than collapsing into
 * `unlisted` because "we cannot look right now" and "it is not in there yet" are
 * different news about a tenant that may well be serving customers.
 */
export function clientTenantView(args: {
  status: string;
  tenantSlug: string | null;
  registry: RegistryResult;
}): ClientTenantView {
  const { status, tenantSlug, registry } = args;
  if (!tenantSlug) return status === "ONBOARDING" ? { kind: "awaiting" } : { kind: "none" };
  if (!registry.ok) return { kind: "unreadable", slug: tenantSlug };
  const tenant = registry.tenants.find((t) => t.slug === tenantSlug);
  return tenant ? { kind: "live", slug: tenantSlug, tenant } : { kind: "unlisted", slug: tenantSlug };
}

/** One registry `modules:` id, resolved against the ADR-010 catalog. */
export interface ModuleLine {
  id: string;
  /** In the catalog — false for an id only the registry knows about. */
  known: boolean;
  /** What it unlocks, in the catalog's own words; null for an unknown id. */
  surface: string | null;
}

/**
 * A tenant's granted modules, in CATALOG order, deduplicated.
 *
 * Catalog order rather than registry order so the list reads the same for every tenant
 * (core first, add-ons in the order they are sold) instead of in whatever sequence the
 * provisioning form happened to write. An id the catalog does not know is kept — a
 * registry entry is hand-editable and dropping a granted module would under-report what
 * a partner's client actually has — but it is flagged, so the caller can render it as
 * the raw id it is rather than invent a name for it.
 */
export function moduleLines(ids: readonly string[]): ModuleLine[] {
  const granted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const known: ModuleLine[] = MODULES.filter((m) => granted.has(m.id)).map((m) => ({
    id: m.id,
    known: true,
    surface: m.surface,
  }));
  const catalog = new Set<string>(MODULES.map((m) => m.id));
  const unknown: ModuleLine[] = [...granted]
    .filter((id) => !catalog.has(id))
    .map((id) => ({ id, known: false, surface: null }));
  return [...known, ...unknown];
}

/**
 * Display labels for a tenant's `languages:`, in registry order.
 *
 * An unrecognised code passes through as itself: the registry is the source of truth
 * and a tenant serving a language this list has not caught up with should still be
 * reported, not silently dropped from the count the partner is reading.
 */
export function languageLabels(codes: readonly string[]): string[] {
  return codes.map((code) => TENANT_LANGUAGES.find((l) => l.code === code)?.label ?? code);
}

/** The plan, reduced to what both partner surfaces print. */
export interface PlanLine {
  /** `planState` — the same verdict the pay button and the double-charge guard read. */
  state: PlanState;
  /** Newest subscription's amount, or null when a plan exists with no subscription. */
  amountCents: number | null;
  /** Mollie interval grammar, for `intervalKeyOf`. Null with no subscription. */
  interval: string | null;
}

interface BillingLike {
  readonly subscriptions: readonly { readonly amountCents: number; readonly interval: string; readonly status: string }[];
  readonly payments: readonly { readonly sequenceType: string; readonly status: string }[];
}

/**
 * The plan for one client, or null when no plan has been defined at all.
 *
 * `state` comes from `planState`, not from a fresh reading of the subscription: that
 * function is where the mandate-validation window ("processing") is defined, and the
 * whole reason it exists is that anything else eventually shows a second pay button to
 * somebody whose money has already left. The caller must branch on this value, never
 * on `subscriptions[0].status`.
 *
 * `payments` must be the FIRST-sequence window — the same scoping the dashboard query
 * documents. Handed a full history it would eventually push the `first` payment out of
 * the window and read a paid plan as unpaid.
 */
export function planLine(billing: BillingLike | null | undefined): PlanLine | null {
  if (!billing) return null;
  const sub = billing.subscriptions[0];
  return {
    state: planState(sub, [...billing.payments]),
    amountCents: sub?.amountCents ?? null,
    interval: sub?.interval ?? null,
  };
}

/** The one-line tenant + plan summary shown on a client row in the partner list. */
export interface ClientRowSummary {
  /** Registry domain, only ever set for a `live` view — never guessed from the slug. */
  domain: string | null;
  /** Registry lifecycle status (`active`, `provisioning`, …), or null. */
  tenantStatus: string | null;
  view: ClientTenantView["kind"];
  slug: string | null;
  plan: PlanLine | null;
}

/**
 * The compact row line: what this client's tenant and plan are, at a glance.
 *
 * Shares `clientTenantView` with the panel on purpose. The row is the surface a partner
 * actually reads (it is their landing page), so a row that disagreed with the page it
 * links to would be the more visible of the two errors.
 */
export function clientRowSummary(args: {
  status: string;
  tenantSlug: string | null;
  registry: RegistryResult;
  billing: BillingLike | null | undefined;
}): ClientRowSummary {
  const view = clientTenantView(args);
  return {
    domain: view.kind === "live" ? view.tenant.domain : null,
    tenantStatus: view.kind === "live" ? view.tenant.status : null,
    view: view.kind,
    slug: args.tenantSlug,
    plan: planLine(args.billing),
  };
}
