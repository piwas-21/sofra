import { NextResponse } from "next/server";
import { boxAuthorized } from "@/lib/backup-agent-auth";
import { authenticatedPrinterBox } from "@/lib/printer-agent-auth";
import { printerCredentialsConfigured } from "@/lib/printer-credential-crypto";
import { printerReportSchema, PRINTER_SYNC_MAX_BODY_BYTES } from "@/lib/printer-access-policy";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { syncPrinterCredentials } from "@/lib/printer-credential-sync";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const box = authenticatedPrinterBox(request);
  if (!box) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!printerCredentialsConfigured()) return NextResponse.json({ error: "Unavailable" }, { status: 503, headers });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Invalid report" }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > PRINTER_SYNC_MAX_BODY_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: "Too large" }, { status: 413, headers });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed;
  try { parsed = printerReportSchema.safeParse(JSON.parse(text)); }
  catch { return NextResponse.json({ error: "Invalid report" }, { status: 400, headers }); }
  if (!parsed.success) return NextResponse.json({ error: "Invalid report" }, { status: 400, headers });
  if (!boxAuthorized(box, parsed.data.box)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  const registry = await loadTenantRegistry();
  if (!registry.ok) return NextResponse.json({ error: "Registry unavailable" }, { status: 503, headers });
  try {
    const jobs = await syncPrinterCredentials(parsed.data, registry.tenants);
    if (!jobs) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    return NextResponse.json({ jobs }, { headers });
  } catch {
    // Never serialize Prisma errors: their arguments can contain credential material.
    return NextResponse.json({ error: "Sync unavailable" }, { status: 503, headers });
  }
}
