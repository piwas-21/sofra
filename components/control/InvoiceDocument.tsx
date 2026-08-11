import { useTranslations } from "next-intl";
import { eur, shortDate } from "@/lib/format";

/** Both snapshots are stored as JSON, so they are read structurally rather than
 *  as Prisma types — the whole point is that they are frozen copies, not joins. */
type PartySnapshot = {
  legalName?: string;
  tradeName?: string | null;
  addressLine1?: string;
  addressLine2?: string | null;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  vatNumber?: string | null;
  registrationNo?: string | null;
  iban?: string | null;
};

export type InvoiceView = {
  number: string;
  issuedAt: Date;
  sellerSnapshot: unknown;
  buyerSnapshot: unknown;
  tenantSlug: string;
  currency: string;
  netCents: number;
  vatCents: number;
  grossCents: number;
  vatRateBps: number;
  taxTreatment: string;
  taxNote: string | null;
  lines: { id: string; description: string; quantity: number; netCents: number }[];
};

const party = (raw: unknown): PartySnapshot => (raw ?? {}) as PartySnapshot;

function Address({ p, t }: Readonly<{ p: PartySnapshot; t: (k: string) => string }>) {
  return (
    <div className="not-prose">
      <p className="font-bold">{p.legalName}</p>
      {p.tradeName && <p>{p.tradeName}</p>}
      <p>{p.addressLine1}</p>
      {p.addressLine2 && <p>{p.addressLine2}</p>}
      <p>
        {p.postalCode} {p.city}
      </p>
      <p>{p.countryCode}</p>
      {p.registrationNo && (
        <p className="mt-1 text-sm">
          {t("reg")} {p.registrationNo}
        </p>
      )}
      {p.vatNumber && (
        <p className="text-sm">
          {t("vat")} {p.vatNumber}
        </p>
      )}
    </div>
  );
}

/**
 * The invoice itself.
 *
 * Rendered as HTML with a print stylesheet rather than generated as a PDF, and
 * that is deliberate: this repo carries eleven dependencies and hand-rolls both
 * its Mollie and its Resend clients rather than take an SDK, so adding a PDF
 * engine for one document would be against its whole grain. The legal
 * requirement is the CONTENT, not the container — and because the data model is
 * structured, a PDF (or Peppol/Factur-X later) is a renderer over the same rows
 * rather than a migration.
 *
 * Everything here comes from the stored snapshots, never from a live join, so an
 * old invoice keeps saying what it said on the day it was issued.
 */
export default function InvoiceDocument({ invoice }: Readonly<{ invoice: InvoiceView }>) {
  const t = useTranslations("control.invoice");
  const seller = party(invoice.sellerSnapshot);
  const buyer = party(invoice.buyerSnapshot);
  const showsVat = invoice.vatRateBps > 0;

  return (
    <article className="mx-auto max-w-3xl bg-card p-8 print:bg-white print:p-0">
      <header className="flex flex-wrap justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
          <p className="mt-1 font-mono text-sm">{invoice.number}</p>
          <p className="font-label text-sm text-muted-foreground">
            {shortDate(invoice.issuedAt)}
          </p>
        </div>
        <div className="font-label text-sm">
          <Address p={seller} t={t} />
          {seller.iban && (
            <p className="mt-1 text-sm">
              {t("iban")} {seller.iban}
            </p>
          )}
        </div>
      </header>

      <section className="mt-8 font-label text-sm">
        <p className="text-muted-foreground">{t("billedTo")}</p>
        <div className="mt-1">
          <Address p={buyer} t={t} />
        </div>
      </section>

      <table className="mt-8 w-full font-label text-sm">
        <thead>
          <tr className="border-b-2 border-border text-left">
            <th className="py-2">{t("description")}</th>
            <th className="py-2 text-right">{t("qty")}</th>
            <th className="py-2 text-right">{t("net")}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id} className="border-b border-border">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right">{l.quantity}</td>
              <td className="py-2 text-right">{eur(l.netCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end font-label text-sm">
        <dl className="w-64">
          <div className="flex justify-between py-1">
            <dt>{t("net")}</dt>
            <dd>{eur(invoice.netCents)}</dd>
          </div>
          {/* A reverse-charged or out-of-scope supply shows NO VAT line at all.
              Printing "VAT 0%" is the classic Dutch error: a zero RATE is a
              different thing in law from a TRANSFER of liability, and an invoice
              claiming the former for the latter is wrong even though both show
              no money. The sentence below carries the meaning instead. */}
          {showsVat && (
            <div className="flex justify-between py-1">
              <dt>{t("vatRate", { rate: invoice.vatRateBps / 100 })}</dt>
              <dd>{eur(invoice.vatCents)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t-2 border-border py-2 font-bold">
            <dt>{t("total")}</dt>
            <dd>{eur(invoice.grossCents)}</dd>
          </div>
        </dl>
      </section>

      {invoice.taxNote && (
        <p className="mt-6 font-label text-sm font-bold">{invoice.taxNote}</p>
      )}

      <footer className="mt-8 font-label text-xs text-muted-foreground">
        <p>{t("service", { tenant: invoice.tenantSlug })}</p>
      </footer>
    </article>
  );
}
