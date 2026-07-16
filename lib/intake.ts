import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Shared guard for the public intake POSTs (partner apply, signup): IP rate
 * limit → JSON parse → honeypot drop. Returns the parsed body to proceed, or a
 * NextResponse to return immediately (429 rate-limited, 400 bad JSON, or a 200
 * decoy for a honeypot-filled bot). Callers then run their own zod schema.
 */
export async function guardIntake(
  request: Request,
  rateKey: string,
): Promise<{ body: Record<string, unknown> } | { response: NextResponse }> {
  if (!rateLimit(`${rateKey}:${clientIp(request)}`, 5, 15 * 60 * 1000)) {
    return { response: NextResponse.json({ ok: false }, { status: 429 }) };
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return { response: NextResponse.json({ ok: false }, { status: 400 }) };
  }

  // Bots fill the hidden honeypot field; pretend success and drop it.
  if (typeof body.company_website === "string" && body.company_website.length > 0) {
    return { response: NextResponse.json({ ok: true }) };
  }

  return { body };
}
