---
name: monodesign-colorize
description: Apply or rework the color system — brand color extraction, OKLCH palette construction, token architecture, dark/light mode, and contrast verification.
type: design-sub-command
argument-hint: "[target or brand description]"
user-invocable: true
---

# Monodesign: Colorize

Apply or rebuild the color system. Read `reference/colorize.md` and `reference/color-and-contrast.md` from the monodesign skill directory for the full protocol.

## Color Strategy (choose one before picking colors)

| Strategy | Surface area | When to use |
|---|---|---|
| **Restrained** | Tinted neutrals + one accent ≤10% | Product default; brand minimalism |
| **Committed** | One saturated color at 30–60% of surface | Brand default for identity-driven pages |
| **Full palette** | 3–4 named roles, used deliberately | Brand campaigns; data visualization |
| **Drenched** | Surface IS the color | Brand heroes, campaign pages |

## OKLCH Rules

- Use OKLCH everywhere. Never `#000` or `#fff` — tint every neutral toward the brand hue (chroma 0.005–0.01)
- Reduce chroma as lightness approaches 0 or 100 (high chroma at extremes looks garish)
- Tinted neutrals: add 0.005–0.015 chroma toward the brand's hue, not toward generic warmth
- Gray text on colored background looks washed out — use a darker shade of the bg hue or transparency

## Theme Decision

Dark vs. light is never a default. Write one sentence of physical scene: who uses this, where, under what ambient light, in what mood. If the sentence doesn't force dark or light, it's not concrete enough. Add detail until it does.

## Contrast Verification (required)

- Body text: ≥4.5:1 against its background
- Large text (≥18px or bold ≥14px): ≥3:1
- Placeholder text: same 4.5:1 (not the muted-gray default)

The most common failure: muted gray body text on a tinted near-white. If contrast is close, bump body color toward the ink end.

## Anti-Cream Rule

The warm-neutral band (OKLCH L 0.84–0.97, C < 0.06, hue 40–100) reads as cream/sand/paper regardless of what you call it. If the brief is "warm, editorial, refined" — that is NOT a license to use a near-white warm-tinted background. Warmth is carried by accent + typography + imagery. Pick: (a) a saturated brand color as body, (b) a true off-white at chroma 0, or (c) a darker mid-tone tinted neutral.

## Token Architecture

```css
:root {
  /* Brand */
  --color-brand: oklch(/* primary */);
  --color-brand-muted: oklch(/* lower chroma */);
  
  /* Surfaces */
  --color-bg: oklch(/* page ground */);
  --color-surface: oklch(/* panels */);
  --color-surface-raised: oklch(/* cards */);
  
  /* Text */
  --color-ink: oklch(/* headings */);
  --color-body: oklch(/* body */);
  --color-muted: oklch(/* captions */);
  --color-faint: oklch(/* disabled */);
  
  /* Interactive */
  --color-accent: oklch(/* CTA, links */);
  --color-accent-hover: oklch(/* hover state */);
}
```
