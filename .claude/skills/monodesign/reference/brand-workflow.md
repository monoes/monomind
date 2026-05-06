# Brand Workflow

How to define, document, and operationalize brand identity for a project. Use when the task involves brand identity work, visual identity guidelines, or establishing a brand-consistent design system from scratch.

---

## The Brand Hierarchy

```
brand-guidelines.md          ← Source of truth (human-readable)
       ↓
design-tokens (primitives)   ← Derived color/type values
       ↓
semantic tokens              ← Purpose assignments
       ↓
component tokens             ← Implementation
       ↓
all UI surfaces              ← Consistent brand expression
```

**The principle:** Every design decision in code should trace back to the brand guidelines. When the guidelines change, only the tokens change — not the components.

---

## Step 1: Define Brand Guidelines

Create `BRAND.md` (or `docs/brand-guidelines.md`) as the project's source of truth. Sections to cover:

### Brand Positioning
- The one sentence that describes what this product is and who it's for
- Personality: 3 adjectives that describe the brand's character
- Register: editorial, functional, playful, authoritative, intimate, aspirational?

### Visual Identity

**Color palette** — use OKLCH for all values per the OKLCH-Only Rule:
```
Primary (1 color)
  └── The one vibrant accent (One Voice Rule — no second accent)

Neutrals (3–4 values)
  ├── Page background (warm, never pure white)
  ├── Primary text
  ├── Secondary text
  └── Borders / dividers

Feedback (system colors)
  ├── Error
  ├── Success
  └── Warning
```

**Typography**
```
Display / Headline  — the editorial voice (personality font)
Body                — the readable voice (text font)
Mono                — code / technical content

Rules:
- line-height: 1.6 for body (non-negotiable)
- Headings use clamp() fluid sizing
- Body uses fixed rem
```

**Shape language**
- Default border-radius: 0 (sharp/editorial) or N px (softer/friendly)?
- Is this a brand-register (sharp) or product-register (rounded) surface?
- Shadow depth: flat-by-default or consistently elevated?

**Motion**
- Default easing: `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) for all transitions
- Duration: 150ms (micro) / 250ms (standard) / 400ms (complex)
- Always respect `prefers-reduced-motion`

### Brand Voice
- Tone: formal / conversational / technical / warm?
- Copy rules: short/punchy vs detailed/thorough? Active/imperative? First/second/third person?
- What to avoid: jargon? Hedging? Superlatives?

---

## Step 2: Derive Token Primitives from Brand

Translate brand guidelines → primitive token values. See `token-architecture.md` for the full three-layer system.

For the **color palette**, verify every token value with the OKLCH color space:
1. Convert brand colors to OKLCH (tool: oklch.com)
2. Verify the accent-to-background chroma relationship (warm backgrounds harmonize with warm-hue accents)
3. Check WCAG contrast: text tokens must pass 4.5:1 against surface tokens
4. Build the tonal ramp (8 steps from darkest to lightest) for the primary accent

For **typography**, document:
- Font families and their CDN/license source
- Exact weight and size values for each type style (see design-principles.md Reference Typography System)

---

## Step 3: Sync Brand to Code

Maintain a single-direction sync flow:

```
BRAND.md  ──(manual review)──→  tokens/primitives.css
                                 tokens/semantic.css
                                 tokens/components.css
```

The sync is intentionally manual for the primitive and semantic layers — these changes are load-bearing and should be reviewed, not automated. Component tokens can be generated.

**Validation checks after any brand update:**
1. Run WCAG contrast check on all text/surface token pairs
2. Check all OKLCH values still use OKLCH (not hex/hsl)
3. Verify there is still exactly one vibrant accent (One Voice Rule)
4. Verify page background is warm, not pure white (Paper-Not-White Rule)

---

## Step 4: Brand Consistency Audit

When auditing an existing product for brand consistency, check:

### Visual consistency
- [ ] All colors trace to the brand token system — no orphaned hex values in components
- [ ] Typography scale and weights match the brand spec
- [ ] Border-radius is consistent with the brand's shape language
- [ ] The accent color appears on ≤10% of any given screen
- [ ] No second accent color has crept in

### Voice consistency
- [ ] Copy tone matches the brand voice guidelines
- [ ] No hedging language ("we think", "maybe", "might be useful")
- [ ] CTAs are imperative and clear
- [ ] Error messages are direct, not apologetic

### Motion consistency
- [ ] All transitions use the brand easing token (`--ease-out`)
- [ ] Duration values are from the brand scale (fast/base/slow)
- [ ] No bounce or elastic easing anywhere

---

## Visual Identity Quick Reference

### Logo Usage
- Use the correct variant for context (primary vs. compact vs. icon-only)
- Maintain minimum clear space around all logo variants
- Never stretch, distort, recolor, or add effects
- Never place on a busy background without a scrim

### Color Usage Ratios (rule of thumb)
- 60% neutral/background surfaces
- 30% secondary/supporting tones
- 10% accent (the one vibrant color)

### Icon System
- One icon family across the entire product
- Consistent stroke weight and corner radius
- Filled vs outline: pick one style per hierarchy level — don't mix
- All icons have `aria-label` or accompanying visible text

### Photography / Illustration
- Define the lighting and mood palette (warm / cool / neutral)
- Establish subject guidelines (people-focused? abstract? product?)
- Consistent editing style (desaturated / vibrant / duotone?)

---

## Brand Register Decision

Before any design session, confirm the **register** of the surface you're designing:

| Register | Characteristics | Shape language | Motion |
|---|---|---|---|
| Brand / marketing | Expressive, editorial, emotional | Sharp edges, strong hierarchy | Cinematic, scroll-driven |
| Product / functional | Efficient, clear, reliable | Slight radius ok, systematic | Micro-interactions, functional |
| Data / dense | Precise, neutral, information-first | Compact, tabular | Minimal, purposeful |

The register determines which rules are in effect. Italic serif display type is appropriate on a brand surface; embarrassing on a product surface. Glassmorphism on a product surface is decorative noise; on a landing page it can be intentional.

Cross-register failures (product surfaces with brand-surface decoration, or marketing pages with dense product UI) are among the most common and most damaging design mistakes.
