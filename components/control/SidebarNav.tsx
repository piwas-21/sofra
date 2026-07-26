"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Admin navigation. Client-side only to mark the current page — the links are
 * plain <Link>s, so navigation works untouched without JS.
 *
 * Two renderings of the same items, because a vertical sidebar on a phone means
 * scrolling past ten links to reach the page: below `lg` it is a compact
 * wrapped row (group labels dropped — the grouping is a desktop scanning aid,
 * not information), and from `lg` it is the grouped column.
 *
 * "Current" is longest-prefix, not equality, so /admin/clients/<id> still lights
 * up Clients. /admin is the exception — every admin path starts with it, so it
 * only matches exactly.
 */
export default function SidebarNav({ groups }: Readonly<{ groups: NavGroup[] }>) {
  const pathname = usePathname();
  const active = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => (h === "/admin" ? pathname === h : pathname === h || pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];

  const link = (item: NavItem, block: boolean) => {
    const isActive = item.href === active;
    return (
      <Link
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`${block ? "block" : "inline-block"} rounded-craft px-3 py-1.5 transition-colors ${
          isActive ? "bg-primary/10 text-primary font-bold" : "hover:bg-foreground/5 hover:text-primary"
        }`}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav aria-label="Admin sections" className="font-label">
      {/* Phone / tablet: one compact wrapped row. */}
      <ul className="lg:hidden flex flex-wrap gap-x-1 gap-y-0.5 -mx-3">
        {groups.flatMap((g) => g.items).map((item) => (
          <li key={item.href}>{link(item, false)}</li>
        ))}
      </ul>

      {/* Desktop: grouped column. */}
      <div className="hidden lg:block">
        {groups.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <h2 className="px-3 mb-1 text-xs uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href} className="text-lg">
                  {link(item, true)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
