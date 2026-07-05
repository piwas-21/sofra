import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LoginForm from "@/components/control/LoginForm";
import { SuccessMessage } from "@/components/control/StatusMessage";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    redirect(session.user.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  const { set } = await searchParams;

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <a href="/" className="font-hand text-4xl font-bold text-primary">
        Sofra
      </a>
      <h1 className="mt-8 font-display font-bold text-5xl">Partner sign in</h1>
      <p className="mt-3 text-muted-foreground">
        For Sofra partners. Not a partner yet?{" "}
        <a className="underline" href="/#partner">
          Become one.
        </a>
      </p>
      <div className="mt-8 hand-drawn-border bg-card p-6">
        {set === "1" && (
          <div className="mb-6">
            <SuccessMessage>Password saved — you can sign in now.</SuccessMessage>
          </div>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
