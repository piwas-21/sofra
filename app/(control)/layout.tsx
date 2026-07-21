// Second root layout: the control plane (login, invite/reset, partner
// dashboard, founder admin). Lives outside [locale] on purpose — see
// SOFRA-PARTNER-PLAN §2 — and follows the marketing site's language via the
// NEXT_LOCALE cookie (sofra #9). Structurally LTR even under `ar`: the
// dashboard chrome uses physical Tailwind utilities, so a dir flip would
// half-mirror it — a real RTL pass is a separate effort.
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import "../globals.css";
import { controlLocale } from "@/lib/control-locale";
import { fontClassNames, themeInitScript } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Sofra — Partner area",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
};

export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const locale = await controlLocale();
  // Client components only need the control-plane namespaces — don't ship
  // the whole marketing catalogue to the browser.
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return (
    <html lang={locale} suppressHydrationWarning className={fontClassNames}>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans paper-texture">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <NextIntlClientProvider
          locale={locale}
          messages={{ auth: messages.auth, control: messages.control }}
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
