import { apiClientHeaders, expect, test } from "./helpers/fixtures";

// The public contact intake (`/api/waitlist`, kept at that path since the waitlist
// was retired) — G17: it is unauthenticated and it SENDS MAIL, so it must be
// rate-limited like the other two intakes.
//
// Why an e2e and not a unit test: the limit lives in `guardIntake`, which is
// already unit-tested through `lib/rate-limit.ts`. What was missing was not the
// rule but the WIRING — this route simply never called it — and only a real
// request through the real handler can show that it does now.
//
// Every test takes ONE apparent client address (`apiClientHeaders`) and reuses it
// for all of its own calls, which is what makes counting to the limit possible
// without throttling the rest of the suite. It is passed explicitly because
// `page.request` does not inherit the fixture's browser headers — see the note on
// `apiClientHeaders`, which exists because this spec found that out the hard way.
//
// The send itself comes back `{sent:false}` in this suite (`RESEND_API_KEY` is
// blank), so an accepted POST answers 502 or 503 rather than 200. That is
// deliberate here: what is asserted is "not refused as rate-limited", never a
// successful delivery, so the spec cannot silently start passing for the wrong
// reason.

const CONTACT_URL = "/api/waitlist";

const body = (n: number) => ({
  intent: "demo",
  name: `Contact ${n}`,
  restaurant: `Restaurant ${n}`,
  email: `contact${n}@example.com`,
  city: "Geneva",
  locale: "en",
});

test("the sixth contact POST from one client is refused", async ({ page }) => {
  const headers = apiClientHeaders();
  // Five is the shared intake allowance (guardIntake: 5 per IP per 15 min).
  for (let i = 1; i <= 5; i += 1) {
    const res = await page.request.post(CONTACT_URL, { headers, data: body(i) });
    expect(res.status(), `POST ${i} must not be rate-limited`).not.toBe(429);
  }

  const sixth = await page.request.post(CONTACT_URL, { headers, data: body(6) });
  expect(sixth.status()).toBe(429);
});

test("a honeypot-filled contact POST is still dropped silently", async ({ page }) => {
  // The route's own `company` honeypot predates the shared `company_website` one
  // and every deployed marketing client still sends it, so routing through
  // guardIntake must not have retired it. A bot must read success, not a 400 that
  // tells it which field gave it away.
  const res = await page.request.post(CONTACT_URL, {
    headers: apiClientHeaders(),
    data: { ...body(1), company: "definitely-a-bot" },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("a malformed contact POST is a 400, not a 500", async ({ page }) => {
  const res = await page.request.post(CONTACT_URL, {
    headers: { ...apiClientHeaders(), "content-type": "application/json" },
    data: "not json at all",
  });
  expect(res.status()).toBe(400);
});
