import { findValidToken } from "@/lib/tokens";
import SetPasswordForm from "@/components/control/SetPasswordForm";

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = await findValidToken(token, "reset");

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <a href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </a>
      <h1 className="mt-8 font-display font-bold text-5xl">New password</h1>
      {valid ? (
        <div className="mt-8 hand-drawn-border bg-card p-6">
          <SetPasswordForm token={token} purpose="reset" />
        </div>
      ) : (
        <p className="mt-3 text-muted-foreground">
          This reset link is invalid or has expired.{" "}
          <a className="underline" href="/forgot">
            Request a new one.
          </a>
        </p>
      )}
    </main>
  );
}
