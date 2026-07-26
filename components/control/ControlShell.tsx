import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { logoutAction } from "@/lib/actions/auth-actions";
import SidebarNav, { type NavGroup, type NavItem } from "./SidebarNav";

/** Shared chrome for the partner dashboard and founder admin. Labels arrive
 *  translated from the server layouts (control-plane i18n, sofra #9).
 *
 *  Two nav shapes, because the two surfaces are different sizes: the partner
 *  dashboard has one to three destinations and keeps them inline in the header
 *  (`nav`), while admin has ten and gets a grouped sidebar (`groups`) — ten
 *  equal-weight links in a row is a list to scan, not a structure to navigate.
 *  The sidebar collapses to a scrollable strip under the header on small
 *  screens rather than hiding behind a toggle: no JS, nothing to discover. */
export default function ControlShell({
  title,
  nav,
  groups,
  userLabel,
  signOutLabel,
  children,
}: {
  title: string;
  nav?: NavItem[];
  groups?: NavGroup[];
  userLabel: string;
  signOutLabel: string;
  children: React.ReactNode;
}) {
  const inlineNav = nav ?? [];
  return (
    <>
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xs border-b-2 border-border">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/" className="flex items-center gap-2 text-primary shrink-0">
              <BrandMark className="h-9 w-auto" />
              <span className="font-hand text-3xl font-bold">SofraPiwas</span>
            </Link>
            <span className="masking-tape font-label text-sm px-3 py-0.5 text-muted-foreground shrink-0">
              {title}
            </span>
            {inlineNav.length > 0 && (
              <nav className="hidden md:flex items-center gap-5 font-label text-lg">
                {inlineNav.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="hover:text-primary transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            )}
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
                {signOutLabel}
              </button>
            </form>
          </div>
        </div>
        {inlineNav.length > 0 && (
          /* Mobile nav row (inline shape only — the sidebar has its own) */
          <nav className="md:hidden mx-auto max-w-7xl px-6 pb-3 flex flex-wrap gap-4 font-label">
            {inlineNav.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-primary transition-colors">
                {item.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      {groups ? (
        <div className="mx-auto max-w-7xl px-6 lg:flex lg:gap-8">
          <aside className="lg:w-52 lg:shrink-0 lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto py-3 lg:py-8 border-b-2 lg:border-b-0 lg:border-r-2 border-border lg:pr-4">
            <SidebarNav groups={groups} />
          </aside>
          <main className="min-w-0 flex-1 py-8">{children}</main>
        </div>
      ) : (
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      )}
    </>
  );
}
