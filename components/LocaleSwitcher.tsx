"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const labels: Record<string, string> = {
  en: "EN",
  fr: "FR",
  de: "DE",
  nl: "NL",
  tr: "TR",
  ar: "AR",
};

export default function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label={label} className="flex items-center gap-1 font-label text-sm">
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => router.replace(pathname, { locale: l })}
          aria-current={l === locale ? "true" : undefined}
          className={
            l === locale
              ? "px-2 py-1 rounded-craft bg-primary text-primary-foreground"
              : "px-2 py-1 rounded-craft text-muted-foreground hover:text-foreground transition-colors"
          }
        >
          {labels[l]}
        </button>
      ))}
    </nav>
  );
}
