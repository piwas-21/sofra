"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle({ label }: { label: string }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // private mode — theme just won't persist
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="hand-drawn-border h-10 w-10 grid place-items-center text-lg
                 hover:border-primary transition-colors"
    >
      {/* Render both, hide one via CSS — avoids a hydration flash before state settles */}
      <span className={dark === null ? "dark:hidden" : dark ? "hidden" : ""}>🌙</span>
      <span className={dark === null ? "hidden dark:inline" : dark ? "" : "hidden"}>☀️</span>
    </button>
  );
}
