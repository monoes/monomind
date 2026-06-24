---
name: monodesign-extract
description: Extract an implicit design system from an existing codebase — discover tokens, components, patterns, and conventions already present, then codify them into a formal system.
type: design-sub-command
argument-hint: "[target codebase path or project]"
user-invocable: true
---

# Monodesign: Extract

Extract a design system from an existing codebase. Read `reference/extract.md` and `reference/token-architecture.md` from the monodesign skill directory for the full protocol.

## Philosophy

Every codebase with more than a few pages has an implicit design system — inconsistencies, but also patterns that have emerged over time. Extract makes the implicit explicit, without inventing a new system on top of what exists.

## Discovery Phase

**Color inventory**
- Collect all color values used in the codebase (grep for `#`, `rgb`, `hsl`, `oklch`)
- Group by apparent purpose (backgrounds, text, accents, borders, shadows)
- Identify the brand anchor color(s)
- Spot inconsistencies (5 slightly different grays)

**Typography inventory**
- Collect all font-family, font-size, font-weight, line-height, letter-spacing values
- Map to semantic roles (heading-xl, heading-lg, body, caption, etc.)
- Identify the type scale (if any)

**Spacing inventory**
- Collect all padding, margin, gap values
- Identify if a consistent scale exists (4/8/16/24/32/48...)
- Spot outliers

**Component inventory**
- List all recurring UI patterns (buttons, inputs, cards, badges, modals)
- Note variants (primary/secondary/ghost buttons, etc.)
- Identify inconsistent implementations of the same component

## Codification

**Token architecture** (CSS custom properties):
```css
:root {
  /* Colors */
  --color-brand-[scale]: oklch(…);
  --color-surface-[level]: oklch(…);
  --color-ink-[weight]: oklch(…);
  
  /* Type scale */
  --text-[size]: [value];
  --font-[role]: [family];
  
  /* Spacing scale */
  --space-[size]: [rem];
  
  /* Radius */
  --radius-[size]: [rem];
}
```

**Component documentation**
For each identified component: props, variants, states, example usage.

## Output: DESIGN.md

Write a `DESIGN.md` at the project root capturing:
- Brand colors with OKLCH values
- Type scale and font families
- Spacing scale
- Key components with their states
- Design conventions (rounded vs. sharp, dense vs. airy, etc.)

This becomes the anchor for all future `/monodesign` work on this project.
