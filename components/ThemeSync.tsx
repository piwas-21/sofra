"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * React owns <html className> in both root layouts, so any root re-render
 * (e.g. switching the [locale] segment) wipes the `dark` class that the
 * pre-hydration init script / ThemeToggle added imperatively. Re-apply the
 * stored theme — falling back to the device preference — after every
 * navigation.
 */
export default function ThemeSync() {
  const pathname = usePathname();

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {
      // private mode — device preference below still applies
    }
    const dark = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  }, [pathname]);

  return null;
}
