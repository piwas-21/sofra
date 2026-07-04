# Sofra design tokens — craft/handmade, food-warm

The Sofra design system speaks the same **craft/handmade language** as domainio's
"Pastel/Handmade v2" (its port source), re-flavoured for food: colours are named
after kitchen & pantry things. Zero gradients — flat pigment on paper.

Source of truth: [`app/globals.css`](../app/globals.css) (CSS variables, HSL triplets)
+ [`tailwind.config.ts`](../tailwind.config.ts) (semantic `craft.*` palette).

## Palette

| Token | Light | Dark | Notes |
|---|---|---|---|
| cream (bg) | `#FFF9F2` | `#211A16` | dark = late-evening kitchen aubergine, **not an invert** |
| ink (text) | `#3B2E26` | `#F2E9DD` | roasted coffee / warm cream |
| **terracotta** (primary) | `#A84B2F` | `#F2B48C` | paprika/clay. Light: **5.4:1 on cream** (AA text + AA as button bg under cream text). Dark: 9.4:1 |
| olive (secondary) | `#7C8450` | `#B5BC8A` | surfaces/decoration. For light-mode TEXT use `craft.olive.text` `#5A6139` (5.2:1) |
| saffron (accent) | `#D9A441` | `#E8C87C` | **decorative/large text only** in light mode; small text uses `craft.saffron.text` `#8A6D2B` |
| beige (borders) | `#EAE0D2` | `#3E3630` | kraft paper |
| surface (cards) | `#FFFCF8` | `#2C241F` | warm white plate |
| success | `#8CB89A` (text `#4C7259`) | `#8CB89A` | muted moss |
| error | `#CC5A50` | `#E8948C` | soft brick — deliberately pinker than the terracotta primary |

## Typography (all self-hosted via `next/font/google`)

| Role | Font | Tailwind |
|---|---|---|
| Body | Quicksand | `font-sans` |
| Hero display | Amatic SC | `font-display` |
| Handwritten headings | Caveat | `font-hand` |
| Labels / badges | Kalam | `font-label` |
| Typewriter / technical | Special Elite | `font-mono` |

## Craft utilities (globals.css)

`.paper-texture` (SVG noise), `.torn-edge` (SVG mask), `.scribble-underline`
(olive; `-terracotta` variant), `.hand-drawn-border` (irregular radius
`255px 15px 225px 15px / 15px 225px 15px 255px`), `.deckled-edge`, `.masking-tape`,
`.stamp` (rubber-stamp, noise-masked), `.btn-artisanal` (physical offset shadow
`3px 3px 0` + hover lift), `.ruled-lines` (notebook lines), `.menu-leaders`
(dotted price leaders), `.craft-glow`, `.btn-primary`, `.btn-secondary`,
`.input-primary`.

## Deliberate divergences from the RUMI frontend — do not "fix"

1. **Tailwind, not CSS Modules.** Sofra is a separate product surface with its own rules.
2. **Dark mode is class-based `.dark`** (Tailwind-native, localStorage `theme` key),
   not RUMI's `html[data-theme="dark"]`.
3. All assets self-hosted (fonts via next/font, watercolour hero is an inline SVG
   component — domainio's hot-linked googleusercontent blob was deliberately not ported).

## Changing the palette

Every colour flows from the HSL triplets in `:root` / `.dark` in `app/globals.css`.
Contrast-check any change against cream/aubergine before locking
(domainio precedent: its coral had to darken from #E8927C to #AE5038 to pass AA —
Sofra's terracotta was chosen pre-checked).
