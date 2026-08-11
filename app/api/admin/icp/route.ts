// ICP export as CSV (SOFRA-BILLING-IDENTITY-PLAN B7).
//
// A route handler rather than a server action because the deliverable is a FILE:
// the accountant opens it in a spreadsheet and types the figures into the
// Belastingdienst's form. A server action cannot set Content-Disposition.
//
// Guards itself with requireAdmin() — §5.1 applies to route handlers exactly as
// it does to pages, and this one returns every EU customer's VAT number and what
// they were billed.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { clampQuarter, quarterRange, toIcpCsv, toIcpLines } from "@/lib/icp";

export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const now = new Date();
  const year = Number(url.searchParams.get("y")) || now.getUTCFullYear();
  const rawQuarter = Number(url.searchParams.get("q")) || Math.floor(now.getUTCMonth() / 3) + 1;
  // Clamped rather than rejected: a nonsense quarter in a URL should give the
  // nearest real one, not a 400 in the middle of a filing.
  const quarter = clampQuarter(rawQuarter);
  const { from, to } = quarterRange(year, quarter);

  const invoices = await db.invoice.findMany({
    where: { taxTreatment: "EU_REVERSE_CHARGE", issuedAt: { gte: from, lt: to } },
    select: { buyerSnapshot: true, netCents: true },
  });

  const lines = toIcpLines(invoices);

  // REFUSE rather than hand over a quarter that is quietly short.
  //
  // A reverse charge requires the customer's VAT number, so an invoice marked
  // EU_REVERSE_CHARGE without one is a contradiction and gets dropped by
  // `toIcpLines`. The page shows that as a red banner — but the CSV is the
  // artefact that actually gets filed, and anyone fetching this URL directly, or
  // forwarding the file on, would see nothing to distinguish an incomplete list
  // from a complete one. The empty case deliberately still returns a header-only
  // file ("asked, and the answer was none"), which is exactly why a short file
  // must not look the same.
  const listed = lines.reduce((sum, l) => sum + l.invoiceCount, 0);
  const missing = invoices.length - listed;
  if (missing > 0) {
    return new NextResponse(
      `Refusing to export: ${missing} of ${invoices.length} reverse-charged invoices in ` +
        `${year} Q${quarter} carry no VAT number, so this list would be incomplete. ` +
        `Open /admin/icp?y=${year}&q=${quarter} and fix them first.\n`,
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(toIcpCsv(lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="icp-${year}-Q${quarter}.csv"`,
      // Contains customer VAT numbers and amounts — never cached anywhere.
      "Cache-Control": "no-store",
    },
  });
}
