import { expect, test } from "./helpers/fixtures";
import {
  activateAndLogin,
  attemptProvision,
  login,
  loginAsAdmin,
  mintInviteLink,
  submitSignup,
  uniq,
  expectAccountCreated,
} from "./helpers/flows";
import {
  arrangeMandateLag,
  countInviteTokens,
  countPlansFor,
  countSignups,
  findFirstPayment,
  findPlan,
  findUser,
} from "./helpers/db";

// O2 end to end: the public signup mints the OWNER account and its PENDING plan
// (SOFRA-ONBOARDING-PLAN §3 O2). Nothing is mocked — a real Next build, a real
// Postgres, the real registry fixture, the real auth stack.
//
// Each test owns its own slug + email via the per-run namespace in `uniq`, so the
// suite is rerunnable against a DB that already has its earlier output, and no
// test can be broken by another's rows.
//
// The specs assert through the UI where the UI shows the thing, and through SQL
// (helpers/db.ts) for the invariants that are deliberately invisible — a null
// `passwordHash`, exactly one plan, a subscription's real status. Asserting those
// through the UI would mean trusting the rendering path under test.

// The catalog price for `core + kitchen-board + cashier`, which is what
// `submitSignup` ticks by default. Hard-coded on purpose: the point is that the
// plan is priced from the CATALOG, so recomputing it here with the same function
// the app uses would assert nothing. If the price sheet changes this must be
// updated by hand — that is the intended friction.
const EXPECTED_PLAN_CENTS = 4300;

test.describe("the public signup creates a payable account", () => {
  test("a free slug mints an OWNER, a PENDING plan at the catalog price, and an invite", async ({
    page,
  }) => {
    const slug = uniq.slug("happy");
    const email = uniq.email("happy");

    await submitSignup(page, { slug, email, restaurantName: "Chez E2E" });

    // The customer is told an account exists — and, in this suite, told honestly
    // that the welcome mail did not go out (see expectAccountCreated).
    await expectAccountCreated(page);

    const user = await findUser(email);
    expect(user, "the signup must have created a user").not.toBeNull();
    expect(user!.role).toBe("OWNER");
    // INVITED + no password IS the email verification: lib/auth.ts refuses to log
    // in anyone who is not ACTIVE with a password set, so only someone who can
    // read the mailbox can make this account work.
    expect(user!.status).toBe("INVITED");
    expect(user!.hasPassword).toBe(false);
    expect(await countInviteTokens(user!.id)).toBe(1);

    const plan = await findPlan(slug);
    expect(plan, "the signup must have created a plan").not.toBeNull();
    expect(plan!.subStatus).toBe("PENDING");
    expect(plan!.amountCents).toBe(EXPECTED_PLAN_CENTS);
    expect(plan!.currency).toBe("EUR");
    expect(plan!.interval).toBe("1 month");
    // Owner flow shape: the payer is the user, there is no reseller Client, and
    // no Mollie customer exists until the first payment is actually started.
    expect(plan!.hasPayer).toBe(true);
    expect(plan!.hasClient).toBe(false);
    expect(plan!.hasMollieCustomer).toBe(false);
  });

  test("an INVITED owner cannot log in until the invite is used", async ({ page }) => {
    const slug = uniq.slug("nologin");
    const email = uniq.email("nologin");
    await submitSignup(page, { slug, email });
    await expectAccountCreated(page);

    await login(page, { email, password: "any-password-at-all-9" });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/wrong email or password/i)).toBeVisible();
  });

  test("invite -> password -> login lands on a dashboard showing the plan and a pay button", async ({
    page,
  }) => {
    const slug = uniq.slug("owner");
    const email = uniq.email("owner");
    const password = `e2e-owner-pass-${Date.now()}`;

    await submitSignup(page, { slug, email, restaurantName: "Chez Owner" });
    await expectAccountCreated(page);
    const user = await findUser(email);

    await activateAndLogin(page, {
      inviteLink: await mintInviteLink(user!.id),
      email,
      password,
    });

    // The figure they were quoted, re-quoted from the catalog, on their own page.
    await expect(page.getByText("€ 43,00")).toBeVisible();
    // A fresh self-serve owner has no billing identity yet, so the dashboard
    // offers the DETAILS FORM rather than a pay button — `startPaymentAction`
    // refuses without one (no charge may settle that cannot then be invoiced),
    // and a button that only errors is worse than a link that works.
    await expect(page.getByRole("link", { name: /add your billing details/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /start auto-monthly payment/i })).toHaveCount(0);
    // An owner is not a reseller: no CRM surface.
    await expect(page.getByText(/add a client/i)).toHaveCount(0);
    // And it must NOT claim the restaurant is live — nothing is provisioned yet.
    await expect(page.getByText(/is live on sofrapiwas/i)).toHaveCount(0);

    const after = await findUser(email);
    expect(after!.status).toBe("ACTIVE");
    expect(after!.hasPassword).toBe(true);
  });
});

test.describe("the mandate-lag window never invites a second payment", () => {
  test("a paid first payment with a PENDING plan shows 'activating' and no pay button", async ({
    page,
  }) => {
    const slug = uniq.slug("lag");
    const email = uniq.email("lag");
    const password = `e2e-lag-pass-${Date.now()}`;

    await submitSignup(page, { slug, email, restaurantName: "Chez Lag" });
    await expectAccountCreated(page);
    const user = await findUser(email);
    await activateAndLogin(page, { inviteLink: await mintInviteLink(user!.id), email, password });
    // Before: they have not paid, so they SHOULD be asked for something — the
    // billing details that must precede a charge (see the note above).
    await expect(page.getByRole("link", { name: /add your billing details/i })).toBeVisible();

    // Arrange the window Mollie's mandate lag produces — a `paid` first payment
    // while the subscription is still PENDING. This is a database state, not a
    // stubbed behaviour: `recordPayment` writes the payment row *before* it tries
    // to activate, so a real 503 leaves exactly these rows. Everything the
    // assertions then touch — planState, the dashboard, the pay-button
    // suppression — runs for real. The billing spec reaches the same window
    // through an actual Mollie payment; this one makes it reachable with no key.
    await arrangeMandateLag(slug);

    await page.goto("/dashboard");
    // The wait is stated in full, because one muted word here is what makes a
    // charged customer reach for the only recovery they can see: paying again.
    await expect(page.getByText(/is being set up/i)).toBeVisible();
    await expect(page.getByText(/your first payment went through/i)).toBeVisible();
    await expect(page.getByText(/nothing more to pay/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start auto-monthly payment/i })).toHaveCount(0);
    // And it must not contradict itself by still nudging them to start a
    // subscription they have already paid for.
    await expect(page.getByText(/start your subscription/i)).toHaveCount(0);

    expect((await findPlan(slug))!.subStatus).toBe("PENDING");
  });
});

test.describe("the slug is refused while the customer can still fix it", () => {
  test("a reserved slug is refused at the keyboard, with no request at all", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/signup")) posts.push(r.url());
    });
    const email = uniq.email("reserved");

    // `www` would become the marketing site's own hostname.
    await submitSignup(page, { slug: "www", email });

    await expect(page.getByText(/that address is reserved/i)).toBeVisible();
    expect(posts, "a reserved slug must never reach the server").toHaveLength(0);
    expect(await countSignups(email)).toBe(0);
  });

  test("a taken slug is refused by the server, and the form keeps every answer", async ({
    page,
  }) => {
    const email = uniq.email("taken");
    // `e2e-occupied` is a tenant in the registry fixture. The client cannot know
    // that (shipping the tenant list to every visitor to save a round-trip is a
    // bad trade), so this refusal must come from the server.
    await submitSignup(page, {
      slug: "e2e-occupied",
      email,
      restaurantName: "Chez Collision",
    });

    await expect(page.getByText(/that address is already taken/i)).toBeVisible();
    // Nothing was written — the customer is one field away from succeeding.
    expect(await countSignups(email)).toBe(0);
    // ...and they do not have to retype anything to get there.
    await expect(page.locator('input[name="restaurantName"]')).toHaveValue("Chez Collision");
    await expect(page.locator('input[name="email"]')).toHaveValue(email);
    await expect(
      page.locator('input[name="modules"][type="checkbox"][value="cashier"]'),
    ).toBeChecked();
  });

  test("fixing the address on the spot succeeds", async ({ page }) => {
    const email = uniq.email("retry");
    await submitSignup(page, { slug: "e2e-occupied", email });
    await expect(page.getByText(/already taken/i)).toBeVisible();

    // Change the one field and resubmit — the same form, no reload.
    const slug = uniq.slug("retry");
    await page.fill('input[name="desiredSlug"]', slug);
    await page.click('button[type="submit"]');

    await expectAccountCreated(page);
    expect((await findPlan(slug))?.subStatus).toBe("PENDING");
  });
});

test.describe("what the customer cannot fix becomes a founder lead", () => {
  test("a second signup on the same email creates no second plan", async ({ page }) => {
    const email = uniq.email("dup");
    await submitSignup(page, { slug: uniq.slug("dup1"), email });
    await expectAccountCreated(page);
    expect(await countPlansFor(email)).toBe(1);

    // A different, free slug — so nothing about the SLUG is refusing this. The
    // account already exists, and an anonymous POST cannot prove control of it:
    // otherwise anyone knowing an owner's address could put a priced plan and a
    // pay button on their dashboard.
    const second = uniq.slug("dup2");
    await submitSignup(page, { slug: second, email });
    await expect(page.getByText(/will reach out shortly/i)).toBeVisible();

    expect(await countPlansFor(email), "no second plan may be bound to an existing account").toBe(
      1,
    );
    expect(await findPlan(second), "the second slug must not have a plan").toBeNull();
    // The lead is still captured — the founder decides.
    expect(await countSignups(email)).toBe(2);
  });

  test("resubmitting the same email AND slug is reported as a lead, never as 'taken'", async ({
    page,
  }) => {
    const slug = uniq.slug("resub");
    const email = uniq.email("resub");
    await submitSignup(page, { slug, email });
    await expectAccountCreated(page);

    // This is what a customer does when the welcome email never arrives. Telling
    // them the address they just bought is "already taken" would be a dead end:
    // no lead, no founder notification, no way in.
    await submitSignup(page, { slug, email });
    await expect(page.getByText(/already taken/i)).toHaveCount(0);
    await expect(page.getByText(/will reach out shortly/i)).toBeVisible();
    expect(await countSignups(email)).toBe(2);
  });

  test("an admin's email is never repurposed into an owner", async ({ page }) => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL!;
    const slug = uniq.slug("adminmail");
    await submitSignup(page, { slug, email: adminEmail });

    await expect(page.getByText(/will reach out shortly/i)).toBeVisible();
    expect(await findPlan(slug)).toBeNull();
    // Still an ADMIN, still able to reach /admin.
    const user = await findUser(adminEmail);
    expect(user!.role).toBe("ADMIN");
  });
});

test.describe("provisioning is gated on payment", () => {
  test("an unpaid self-serve tenant is refused before any GitHub call", async ({ page }) => {
    const slug = uniq.slug("gate");
    const email = uniq.email("gate");
    await submitSignup(page, { slug, email });
    await expectAccountCreated(page);
    // Nothing has been paid.
    expect(await findFirstPayment(slug)).toBeNull();

    await loginAsAdmin(page);
    const body = await attemptProvision(page, slug);

    expect(body).toMatch(/no settled first payment/i);
    // The gate is upstream of the round-trip, so the placeholder token is never
    // even offered to GitHub.
    expect(body).not.toMatch(/bad credentials/i);
  });

  test("a tenant with no plan at all is not gated — the founder's own path is untouched", async ({
    page,
  }) => {
    // No signup, no billing row: a founder proposing a tenant by hand. The gate
    // must stay out of the way, so this reaches GitHub and fails on the
    // placeholder token — which is exactly the evidence that it passed.
    await loginAsAdmin(page);
    const body = await attemptProvision(page, uniq.slug("founder"));

    expect(body).not.toMatch(/no settled first payment/i);
    // `couldn't open` is deliberately NOT matched: control.errors.provisionFailed
    // uses a typographic apostrophe (U+2019), and this path returns GitHub's raw
    // text anyway (ProvisioningApiError → ActionError's passthrough).
    expect(body).toMatch(/bad credentials|401/i);
  });
});

test.describe("the signup answer says whether the welcome mail actually went out (G5)", () => {
  test("the suite's own signups report emailed:false, and the copy follows the answer", async ({
    page,
  }) => {
    // Asserted on the RESPONSE, not only on the rendered string: this pins the
    // cause rather than the symptom. The suite runs with RESEND_API_KEY="", so
    // every welcome mail here fails — which is exactly the state that used to be
    // rendered as "check your email to set your password".
    const answer = page.waitForResponse(
      (res) => res.url().includes("/api/signup") && res.request().method() === "POST",
    );

    await submitSignup(page, { slug: uniq.slug("nomail"), email: uniq.email("nomail") });

    const body = await (await answer).json();
    expect(body).toMatchObject({ ok: true, account: true, emailed: false });
    await expectAccountCreated(page);
  });

  test("a signup whose welcome mail DID go out is told to check their email", async ({ page }) => {
    // The one branch no other test can reach: this environment cannot send mail,
    // so the server's success answer is faked at the network boundary. Without
    // it, hardcoding `emailed: false` in the route would keep the whole suite
    // green while every real customer saw the failure copy.
    await page.route("**/api/signup", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, account: true, emailed: true }),
      }),
    );

    await submitSignup(page, { slug: uniq.slug("mailok"), email: uniq.email("mailok") });

    await expect(page.getByText(/check your email to set your password/i)).toBeVisible();
    await expect(page.getByText(/our welcome email didn't get through/i)).toHaveCount(0);
  });
});

test.describe("the founder can see which mails did not get delivered (G16)", () => {
  test("a lead whose welcome mail failed is flagged on /admin/signups", async ({ page }) => {
    // Free evidence: this suite runs with RESEND_API_KEY="" on purpose, so every signup it makes
    // has a failed welcome mail. Before G16 that state was recorded and shown nowhere — the
    // founder's screen looked identical whether the customer got their link or not.
    const restaurantName = `G16 ${uniq.slug("badge")}`;
    await submitSignup(page, {
      slug: uniq.slug("badge"),
      email: uniq.email("badge"),
      restaurantName,
    });
    await expectAccountCreated(page);

    await loginAsAdmin(page);
    await page.goto("/admin/signups");

    const lead = page.locator("li").filter({ hasText: restaurantName });
    await expect(lead).toContainText(/welcome email failed/i);
    await expect(lead).toContainText(/admin\/onboard/i);
  });
});
