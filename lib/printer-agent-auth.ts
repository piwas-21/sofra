import { bearerAuthorized } from "@/lib/cron-auth";

export function authenticatedPrinterBox(request: Request): string | null {
  const prefix = "PRINTER_AGENT_SECRET_";
  const matches = Object.entries(process.env)
    .filter(([name, secret]) => name.startsWith(prefix) && !!secret && bearerAuthorized(request, secret))
    .map(([name]) => name.slice(prefix.length).toLowerCase());
  return matches.length === 1 ? matches[0] : null;
}
