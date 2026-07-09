import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth-actions";

/** Shared chrome for the partner dashboard and founder admin. */
export default function ControlShell({
  title,
  nav,
  userLabel,
  children,
}: {
  title: string;
  nav: { href: string; label: string }[];
  userLabel: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xs border-b-2 border-border">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/" className="font-hand text-3xl font-bold text-primary shrink-0">
              Sofra
            </Link>
            <span className="masking-tape font-label text-sm px-3 py-0.5 text-muted-foreground shrink-0">
              {title}
            </span>
            <nav className="hidden md:flex items-center gap-5 font-label text-lg">
              {nav.map((item) => (
                <a key={item.href} href={item.href} className="hover:text-primary transition-colors">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden sm:block font-label text-sm text-muted-foreground truncate max-w-40">
              {userLabel}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="btn-artisanal rounded-craft border-2 border-border px-3 py-1 font-label text-sm"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        {/* Mobile nav row */}
        <nav className="md:hidden mx-auto max-w-6xl px-6 pb-3 flex flex-wrap gap-4 font-label">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-primary transition-colors">
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </>
  );
}
