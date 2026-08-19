// The ownership test every partner-facing write shares.
//
// Deliberately NOT a "use server" module. Exporting this from one would publish it as
// a callable server-action endpoint whose FIRST argument is the partner id — i.e. a
// remote "read any partner's client" primitive. It lives here so both action files can
// share the one query without that ever becoming possible.

import { db } from "@/lib/db";

/** Loads a client iff it belongs to the calling partner — the ONLY way partner
 *  actions may touch a client row (SOFRA-PARTNER-PLAN §5: every partner query is
 *  scoped by `partnerId` server-side). */
export async function ownClient(partnerId: string, clientId: string) {
  return db.client.findFirst({ where: { id: clientId, partnerId } });
}
