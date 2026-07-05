import { findValidToken } from "@/lib/tokens";
import SetPasswordForm from "@/components/control/SetPasswordForm";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = await findValidToken(token, "invite");

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <a href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </a>
      <h1 className="mt-8 font-display font-bold text-5xl">Welcome aboard</h1>
      {valid ? (
        <>
          <p className="mt-3 text-muted-foreground">
            Hi {valid.user.name} — set a password to open your partner dashboard.
          </p>
          <div className="mt-8 hand-drawn-border bg-card p-6">
            <SetPasswordForm token={token} purpose="invite" />
          </div>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground">
          This invite link is invalid or has expired. Reply to your approval
          email and we&apos;ll send a fresh one.
        </p>
      )}
    </main>
  );
}
