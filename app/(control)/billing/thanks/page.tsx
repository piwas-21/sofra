import Link from "next/link";

// Mollie redirectUrl target after the first-payment checkout (S9). Public and
// unauthenticated — the TENANT lands here, not the founder. Payment state is
// NOT known here (the webhook is the source of truth); keep it generic.
export default function BillingThanksPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <Link href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </Link>
      <h1 className="mt-8 font-display font-bold text-5xl">Thank you!</h1>
      <p className="mt-4 text-muted-foreground">
        Your payment is being processed. Once it&apos;s confirmed, your Sofra subscription starts
        automatically — we&apos;ll be in touch shortly.
      </p>
      <p className="mt-2 font-label text-sm text-muted-foreground">
        Questions? Just reply to any Sofra email.
      </p>
    </main>
  );
}
