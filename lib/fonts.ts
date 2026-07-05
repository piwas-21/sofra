// Sofra craft typography stack — shared by both root layouts
// (the localized marketing tree and the en-only control plane).
import { Quicksand, Amatic_SC, Caveat, Kalam, Special_Elite } from "next/font/google";

export const quicksand = Quicksand({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export const amaticSC = Amatic_SC({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  variable: "--font-display",
  display: "swap",
});

export const caveat = Caveat({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hand",
  display: "swap",
});

export const kalam = Kalam({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700"],
  variable: "--font-label",
  display: "swap",
});

export const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-mono",
  display: "swap",
});

export const fontClassNames = [
  quicksand.variable,
  amaticSC.variable,
  caveat.variable,
  kalam.variable,
  specialElite.variable,
].join(" ");

// Dark-mode init: runs during HTML parse, before hydration, so the page
// doesn't flash the wrong theme. Class-based `.dark` — deliberately diverges
// from the RUMI frontend's data-theme.
export const themeInitScript = `try {
  const theme = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}`;
