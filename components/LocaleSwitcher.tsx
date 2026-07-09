"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

// Native names — shown in the dropdown regardless of the current locale.
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
  tr: "Türkçe",
  ar: "العربية",
};

export default function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="hand-drawn-border h-10 px-3 flex items-center gap-1.5 font-label text-sm
                   uppercase hover:border-primary transition-colors"
      >
        {locale}
        <span
          aria-hidden
          className={`text-[0.6rem] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▼
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute inset-e-0 mt-2 min-w-44 hand-drawn-border bg-card p-1.5 shadow-lg z-50"
        >
          {routing.locales.map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === locale}
                onClick={() => {
                  setOpen(false);
                  router.replace(pathname, { locale: l });
                }}
                className={`w-full text-start px-3 py-2 rounded-craft font-label text-sm transition-colors ${
                  l === locale
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {NATIVE_NAMES[l] ?? l}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
