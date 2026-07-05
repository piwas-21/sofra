// Second root layout: the en-only control plane (login, invite/reset,
// partner dashboard, founder admin). Lives outside [locale] on purpose —
// see SOFRA-PARTNER-PLAN §2. Marketing stays localized under [locale].
import type { Metadata } from "next";
import "../globals.css";
import { fontClassNames, themeInitScript } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Sofra — Partner area",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={fontClassNames}>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans paper-texture">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
