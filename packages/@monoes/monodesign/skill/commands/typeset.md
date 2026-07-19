---
name: monodesign-typeset
description: Replace generic type defaults with fonts that reflect the brand and scale with intentional contrast — font selection, hierarchy, scale, and responsive type systems.
type: design-sub-command
argument-hint: "[target page, component, or whole site]"
user-invocable: true
---

# Monodesign: Typeset

Typography carries most of the information on the page. Replace generic defaults (Inter, Roboto, system fallback at flat scale) with type that reflects the brand and scales with intentional contrast.

Read `reference/typeset.md` and `reference/typography.md` from the monodesign skill directory for the full protocol.

## Register

**Brand**: font selection procedure in `reference/brand.md`. Fluid `clamp()` scale, ≥1.25 ratio between steps.

**Product**: system fonts and familiar sans stacks are legitimate. One well-tuned family typically carries the whole UI. Fixed `rem` scale, 1.125–1.2 ratio.

## Assess Current Typography

**Font choices**
- Are we using invisible defaults? (Inter, Roboto, Arial, Open Sans, system defaults)
- Does the font match the brand personality?
- Are there too many families? (More than 2–3 is almost always a mess)

**Hierarchy**
- Can you tell headings from body from captions at a glance?
- Are sizes too close together? (14px, 15px, 16px = muddy hierarchy)
- Are weight contrasts strong enough? (Medium vs Regular is barely visible)

**Sizing & scale**
- Is there a consistent type scale, or are sizes arbitrary?
- Body text ≥16px?
- Fixed `rem` scales for app UIs; fluid `clamp()` for marketing/content page headings

## Typographic Rules (non-negotiable)

- Cap body line length at **65–75ch**
- Hero/display heading ceiling: `clamp()` max ≤ **6rem (~96px)**
- Display letter-spacing floor: **≥ -0.04em** (anything tighter makes letters touch)
- Use `text-wrap: balance` on h1–h3; `text-wrap: pretty` on long prose
- Pair fonts on a contrast axis (serif + sans, geometric + humanist) — NOT similar families
- Hierarchy through scale + weight contrast (≥1.25 ratio between steps)

## Font Selection Process

1. Load brand context from PRODUCT.md and DESIGN.md
2. Identify brand personality from 3 words or the product description
3. Propose 2–3 Google Fonts / variable font pairings with rationale
4. Load one via `<link>` and demonstrate it on a real page section
5. Iterate until the type feels native to the brand

## Output

- Updated CSS custom properties or tokens for `--font-heading`, `--font-body`, `--font-mono`
- Fluid or fixed type scale as CSS custom properties
- Applied to all heading levels and body copy on the target
