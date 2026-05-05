---
name: monodesign
description: "Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks."
version: 1.0.0
argument-hint: "[command] [target]"
user-invocable: true
triggers:
  - /monodesign
  - /design
  - /frontend-design
  - design the ui
  - redesign this
  - improve the ui
  - make this look better
  - add polish
  - audit the design
  - critique this ui
  - animate this component
  - fix the layout
  - colorize this
  - typeset this
  - design system
  - ui tokens
  - antipattern
  - anti-pattern
  - design review
  - ux review
  - visual design
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - WebSearch
  - WebFetch
license: Apache 2.0. Based on Anthropic's frontend-design skill and the Impeccable design system. See reference/NOTICE.md for attribution.
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

## Setup (non-optional)

Before any design work or file edits, pass these gates. Skipping them produces generic output that ignores the project.

| Gate | Required check | If fail |
|---|---|---|
| Context | PRODUCT.md and DESIGN.md are read from the project root (or `docs/`, `.agents/context/`). | Read both files before continuing. |
| Product | PRODUCT.md exists and is not empty or placeholder (`[TODO]` markers, <200 chars). | Run `/monodesign teach`, then resume. Never synthesize PRODUCT.md from the user's original prompt alone. |
| Command | The matching command reference is loaded when a sub-command is used. | Load `reference/<command>.md` before continuing. |
| Craft | `/monodesign craft` has a user-confirmed shape brief for this task. `teach` / PRODUCT.md never counts as shape. | Run `/monodesign shape` and wait for explicit brief confirmation. |
| Mutation | All active gates above pass. | Do not edit project files yet. |

### 1. Context gathering

Two files, case-insensitive. Look at the project root first, then fall back to `.agents/context/` and `docs/`.

- **PRODUCT.md**: required. Users, brand, tone, anti-references, strategic principles.
- **DESIGN.md**: optional, strongly recommended. Colors, typography, elevation, components.

Read both files directly using the Read tool. If both are already in this session's context, don't re-read them.

If PRODUCT.md is missing, empty, or placeholder (`[TODO]` markers, <200 chars): run `/monodesign teach`, then resume the user's original task with the fresh context. If the original task was `/monodesign craft`, resume into `/monodesign shape` before any implementation work.

If DESIGN.md is missing: nudge once per session (*"Run `/monodesign document` for more on-brand output"*), then proceed.

### 2. Register

Every design task is **brand** (marketing, landing, campaign, long-form content, portfolio: design IS the product) or **product** (app UI, admin, dashboard, tool: design SERVES the product).

Identify before designing. Priority: (1) cue in the task itself ("landing page" vs "dashboard"); (2) the surface in focus; (3) `register` field in PRODUCT.md. First match wins.

Load the matching reference: [reference/brand.md](reference/brand.md) or [reference/product.md](reference/product.md). The shared design laws below apply to both.

## Shared design laws

Apply to every design, both registers. Interpret creatively. Vary across projects; never converge on the same choices. Claude is capable of extraordinary work. Don't hold back.

### Color

- Use OKLCH. Reduce chroma as lightness approaches 0 or 100; high chroma at extremes looks garish.
- Never use `#000` or `#fff`. Tint every neutral toward the brand hue (chroma 0.005–0.01 is enough).
- Pick a **color strategy** before picking colors. Four steps on the commitment axis:
  - **Restrained**: tinted neutrals + one accent ≤10%. Product default; brand minimalism.
  - **Committed**: one saturated color carries 30–60% of the surface. Brand default for identity-driven pages.
  - **Full palette**: 3–4 named roles, each used deliberately. Brand campaigns; product data viz.
  - **Drenched**: the surface IS the color. Brand heroes, campaign pages.
- The "one accent ≤10%" rule is Restrained only. Committed / Full palette / Drenched exceed it on purpose. Don't collapse every design to Restrained by reflex.

### Theme

Dark vs. light is never a default. Not dark "because tools look cool dark." Not light "to be safe."

Before choosing, write one sentence of physical scene: who uses this, where, under what ambient light, in what mood. If the sentence doesn't force the answer, it's not concrete enough. Add detail until it does.

"Observability dashboard" does not force an answer. "SRE glancing at incident severity on a 27-inch monitor at 2am in a dim room" does. Run the sentence, not the category.

### Typography

- Cap body line length at 65–75ch.
- Hierarchy through scale + weight contrast (≥1.25 ratio between steps). Avoid flat scales.

### Layout

- Vary spacing for rhythm. Same padding everywhere is monotony.
- Cards are the lazy answer. Use them only when they're truly the best affordance. Nested cards are always wrong.
- Don't wrap everything in a container. Most things don't need one.

### Motion

- Don't animate CSS layout properties.
- Ease out with exponential curves (ease-out-quart / quint / expo). No bounce, no elastic.
- Always respect `prefers-reduced-motion`.

### Absolute bans

Match-and-refuse. If you're about to write any of these, rewrite the element with different structure.

- **Side-stripe borders.** `border-left` or `border-right` greater than 1px as a colored accent on cards, list items, callouts, or alerts. Never intentional. Rewrite with full borders, background tints, leading numbers/icons, or nothing.
- **Gradient text.** `background-clip: text` combined with a gradient background. Decorative, never meaningful. Use a single solid color. Emphasis via weight or size.
- **Glassmorphism as default.** Blurs and glass cards used decoratively. Rare and purposeful, or nothing.
- **The hero-metric template.** Big number, small label, supporting stats, gradient accent. SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text, repeated endlessly.
- **Modal as first thought.** Modals are usually laziness. Exhaust inline / progressive alternatives first.

### Copy

- Every word earns its place. No restated headings, no intros that repeat the title.
- **No em dashes.** Use commas, colons, semicolons, periods, or parentheses. Also not `--`.

### The AI slop test

If someone could look at this interface and say "AI made that" without doubt, it's failed.

**Category-reflex check.** Run at two altitudes:
- **First-order:** if someone could guess the theme + palette from the category alone ("observability → dark blue", "healthcare → white + teal"), it's the first training-data reflex. Rework.
- **Second-order:** if someone could guess the aesthetic family from category-plus-anti-references, it's the trap one tier deeper. Rework until both answers are non-obvious.

## Antipattern Detection

Before finalizing any design, run the antipattern detector. It checks for 24 known design antipatterns across four categories:

- **slop** — AI tells (purple gradients, side-tabs, identical card grids)
- **quality** — Design principles (spacing, hierarchy, readability)
- **performance** — Technical metrics (touch targets, viewport units)
- **accessibility** — WCAG compliance (contrast, semantic HTML)

To run detection on HTML/CSS files:
```bash
npx impeccable detect <file-or-dir>
```

If `impeccable` is not installed:
```bash
npm install -g impeccable
# or use npx:
npx impeccable@latest detect <file-or-dir>
```

### Design Token System

Use OKLCH-based tokens for every new design. Reference system:

```css
:root {
  /* Typography */
  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'Instrument Sans', system-ui, sans-serif;
  --font-mono: 'Space Grotesk', monospace;

  /* Spacing (8px base grid) */
  --space-xs: 8px;
  --space-sm: 16px;
  --space-md: 24px;
  --space-lg: 32px;
  --space-xl: 48px;
  --space-2xl: 80px;
  --space-3xl: 120px;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);       /* Primary — expo-out */
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1); /* Sharper variant */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast: 0.15s;    /* Color/opacity */
  --duration-base: 0.3s;     /* Default transforms */
  --duration-slow: 0.6s;     /* Orchestrated entrances */
  --duration-slower: 0.8s;
  --duration-slowest: 1.2s;

  /* Colors (OKLCH) */
  --color-ink: oklch(10% 0 0);
  --color-paper: oklch(98% 0 0);
  --color-cream: oklch(96% 0.005 350);    /* Warm off-white bg */
  --color-charcoal: oklch(25% 0 0);
  --color-ash: oklch(55% 0 0);
  --color-mist: oklch(92% 0 0);
  --color-accent: oklch(60% 0.25 350);          /* Editorial Magenta */
  --color-accent-hover: oklch(52% 0.25 350);
  --color-accent-dim: oklch(60% 0.25 350 / 0.15);
  --color-accent-soft: oklch(60% 0.25 350 / 0.25);
}
```

### Shadow System

```css
/* Soft hover lift */
box-shadow: 0 4px 24px -4px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);

/* Lifted card */
box-shadow: 0 20px 40px rgba(0,0,0,0.08);

/* Accent glow (rare — accent-tinted) */
box-shadow: 0 20px 60px oklch(60% 0.25 350 / 0.15);
```

Shadows max at 0.15 alpha. No heavy drop shadows.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Shape, then build a feature end-to-end | [reference/craft.md](reference/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before writing code | [reference/shape.md](reference/shape.md) |
| `teach` | Build | Set up PRODUCT.md and DESIGN.md context | [reference/teach.md](reference/teach.md) |
| `document` | Build | Generate DESIGN.md from existing project code | [reference/document.md](reference/document.md) |
| `extract [target]` | Build | Pull reusable tokens and components into design system | [reference/extract.md](reference/extract.md) |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | [reference/critique.md](reference/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | [reference/audit.md](reference/audit.md) |
| `polish [target]` | Refine | Final quality pass before shipping | [reference/polish.md](reference/polish.md) |
| `bolder [target]` | Refine | Amplify safe or bland designs | [reference/bolder.md](reference/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | [reference/quieter.md](reference/quieter.md) |
| `distill [target]` | Refine | Strip to essence, remove complexity | [reference/distill.md](reference/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [reference/harden.md](reference/harden.md) |
| `onboard [target]` | Refine | Design first-run flows, empty states, activation | [reference/onboard.md](reference/onboard.md) |
| `animate [target]` | Enhance | Add purposeful animations and motion | [reference/animate.md](reference/animate.md) |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs | [reference/colorize.md](reference/colorize.md) |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts | [reference/typeset.md](reference/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy | [reference/layout.md](reference/layout.md) |
| `delight [target]` | Enhance | Add personality and memorable touches | [reference/delight.md](reference/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [reference/overdrive.md](reference/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages | [reference/clarify.md](reference/clarify.md) |
| `adapt [target]` | Fix | Adapt for different devices and screen sizes | [reference/adapt.md](reference/adapt.md) |
| `optimize [target]` | Fix | Diagnose and fix UI performance | [reference/optimize.md](reference/optimize.md) |
| `live` | Iterate | Visual variant mode: iterate on elements in the browser | [reference/live.md](reference/live.md) |

### Routing rules

1. **No argument**: render the table above as the user-facing command menu, grouped by category. Ask what they'd like to do.
2. **First word matches a command**: load its reference file (`Read` the `reference/<command>.md` file) and follow its instructions. Everything after the command name is the target.
3. **First word doesn't match**: general design invocation. Apply the setup steps, shared design laws, and the loaded register reference, using the full argument as context.

Setup (context gathering, register) runs first; sub-commands don't re-invoke `/monodesign`.

If the first word is `craft`, setup still runs first, but `reference/craft.md` owns the rest of the flow.
