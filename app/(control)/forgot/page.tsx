import ForgotPasswordForm from "@/components/control/ForgotPasswordForm";

export default function ForgotPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <a href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </a>
      <h1 className="mt-8 font-display font-bold text-5xl">Forgot password</h1>
      <p className="mt-3 text-muted-foreground">
        Enter your account email and we&apos;ll send a one-time reset link.
      </p>
      <div className="mt-8 hand-drawn-border bg-card p-6">
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
