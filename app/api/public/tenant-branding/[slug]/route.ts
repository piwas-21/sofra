import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { publicTenantBranding } from "@/lib/tenant-branding";

export const dynamic = "force-dynamic";

/** Anonymous: publishes only the attribution already visible in a tenant footer. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const branding = await publicTenantBranding(slug);
    if (!branding) return NextResponse.json({ error: "not found" }, { status: 404 });
    const etag = `"${createHash("sha256").update(JSON.stringify(branding)).digest("hex")}"`;
    const headers = { ETag: etag, "Cache-Control": "public, max-age=0, must-revalidate" };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return NextResponse.json(branding, { headers });
  } catch {
    console.error("tenant branding unavailable");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
