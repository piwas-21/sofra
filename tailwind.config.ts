import type { Config } from "tailwindcss";

/**
 * Sofra design system — "craft/handmade" language, food-warm flavour.
 * Ported from domainio's Pastel/Handmade (v2) system, re-flavoured:
 * coral→terracotta (paprika), sage→olive, lavender→saffron.
 * Colours named after kitchen & pantry things. Zero gradients.
 *
 * NOTE: dark mode is class-based (`.dark`) — this deliberately diverges
 * from the RUMI frontend's `html[data-theme="dark"]`. Do not "fix" it.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: false,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Semantic craft tokens — named after kitchen & pantry things
        craft: {
          // Primary: paprika / terracotta clay pot
          terracotta: {
            light: "#A84B2F", // 5.4:1 on cream — WCAG AA as text & as button bg under cream text
            dark: "#F2B48C", // luminous apricot, 9.4:1 on the dark aubergine bg
            DEFAULT: "hsl(var(--craft-terracotta))",
            foreground: "hsl(var(--craft-terracotta-foreground))",
          },
          // Secondary: olive branch / bay leaf
          olive: {
            light: "#7C8450", // surfaces/decoration; use olive.text for copy on cream
            dark: "#B5BC8A",
            text: "#5A6139", // 5.2:1 on cream — for text usage in light mode
            DEFAULT: "hsl(var(--craft-olive))",
            foreground: "hsl(var(--craft-olive-foreground))",
          },
          // Accent: saffron threads / ochre spice — decorative & large text only in light mode
          saffron: {
            light: "#D9A441",
            dark: "#E8C87C",
            text: "#8A6D2B", // for small-text usage on cream
            DEFAULT: "hsl(var(--craft-saffron))",
            foreground: "hsl(var(--craft-saffron-foreground))",
          },
          // Background: warm cream paper / fresh linen
          cream: {
            light: "#FFF9F2",
            dark: "#211A16", // deep aubergine-charcoal, not cold black
          },
          // Text: warm ink / roasted coffee
          ink: {
            light: "#3B2E26",
            dark: "#F2E9DD",
          },
          // Card surface: warm white plate
          surface: {
            light: "#FFFCF8",
            dark: "#2C241F",
          },
          // Borders: warm beige / kraft paper
          beige: {
            light: "#EAE0D2",
            dark: "#3E3630",
          },
          // State: muted moss success
          success: {
            light: "#8CB89A",
            dark: "#8CB89A",
            text: "#4C7259",
          },
          // State: saffron warning
          warning: {
            light: "#D9A441",
            dark: "#E8C87C",
            text: "#8A6D2B",
          },
          // State: soft brick error (kept clearly pinker than terracotta primary)
          error: {
            light: "#CC5A50",
            dark: "#E8948C",
          },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Organic / hand-drawn irregular radius for cards & buttons
        craft: "255px 15px 225px 15px / 15px 225px 15px 255px",
      },
      fontFamily: {
        // Each chain lists the Latin craft font first, then its Arabic
        // companion (--font-arabic / --font-arabic-display) — the craft fonts
        // have no Arabic glyphs, so Arabic text falls through to the companion.
        // Body: soft rounded sans
        sans: ["var(--font-sans)", "var(--font-arabic)", "Quicksand", "system-ui", "sans-serif"],
        // Display / hero headlines: rough hand-painted feel
        display: ["var(--font-display)", "var(--font-arabic-display)", "Amatic SC", "cursive"],
        // Section headings / subheads: elegant flowing handwriting
        hand: ["var(--font-hand)", "var(--font-arabic-display)", "Caveat", "cursive"],
        // Labels / badges / small UI: neat handwriting
        label: ["var(--font-label)", "var(--font-arabic)", "Kalam", "cursive"],
        // Code / technical: typewriter with ink-bleed texture
        mono: ["var(--font-mono)", "Special Elite", "monospace"],
      },
      spacing: {
        "craft-section": "120px",
        "craft-section-mobile": "64px",
        "craft-gutter": "32px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        "rise-in": "rise-in 0.6s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
