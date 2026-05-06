# Token Architecture

Three-layer token system for scalable, themeable design systems. Use during `extract` and `document` workflows when building or auditing a project's design token structure.

## The Three Layers

```
┌─────────────────────────────────────────┐
│  Component Tokens                       │  Per-component overrides
│  --button-bg, --card-padding            │
├─────────────────────────────────────────┤
│  Semantic Tokens                        │  Purpose-based aliases
│  --color-primary, --spacing-section     │
├─────────────────────────────────────────┤
│  Primitive Tokens                       │  Raw design values
│  --color-ink, --space-4                 │
└─────────────────────────────────────────┘
```

| Layer | Purpose | When to change |
|-------|---------|----------------|
| Primitive | Raw values — colors, sizes, radii | Rarely; these are foundational |
| Semantic | Meaning assignment | When switching themes or rebrand |
| Component | Component customization | Per-component deviations from semantic defaults |

---

## Layer 1: Primitive Tokens

Raw values with no semantic meaning. For the Editorial Sanctuary, these are the OKLCH palette values.

```css
:root {
  /* Colors — OKLCH only (see design-principles.md for full palette) */
  --color-ink-raw:        oklch(10% 0 0);          /* Deep Graphite */
  --color-charcoal-raw:   oklch(25% 0 0);          /* Soft Charcoal */
  --color-ash-raw:        oklch(55% 0 0);          /* Mid Ash */
  --color-mist-raw:       oklch(92% 0 0);          /* Paper Mist */
  --color-paper-raw:      oklch(96% 0.005 350);    /* Warm Ash Cream */
  --color-white-raw:      oklch(98% 0 0);          /* Crisp Paper White */
  --color-accent-raw:     oklch(60% 0.25 350);     /* Editorial Magenta */
  --color-accent-deep-raw:oklch(52% 0.25 350);     /* Editorial Magenta Deep */

  /* Spacing (8-base scale) */
  --space-1:  0.5rem;   /*  8px */
  --space-2:  1rem;     /* 16px */
  --space-3:  1.5rem;   /* 24px */
  --space-4:  2rem;     /* 32px */
  --space-6:  3rem;     /* 48px */
  --space-10: 5rem;     /* 80px */
  --space-15: 7.5rem;   /* 120px */

  /* Typography */
  --font-size-xs:   0.8125rem; /* 13px — captions minimum */
  --font-size-sm:   0.875rem;  /* 14px */
  --font-size-base: 1rem;      /* 16px — body minimum */
  --font-size-lg:   1.125rem;
  --font-size-xl:   1.25rem;
  --font-size-2xl:  1.5rem;
  --font-size-3xl:  1.875rem;
  --font-size-4xl:  2.25rem;

  /* Radius */
  --radius-none: 0;       /* Editorial Sanctuary: sharp by default */
  --radius-sm:   0.25rem;
  --radius-md:   0.5rem;
  --radius-lg:   0.75rem;

  /* Shadows — max 0.15 alpha (Low-Alpha Rule) */
  --shadow-sm:  0 1px 3px rgba(0,0,0,0.06);
  --shadow-md:  0 4px 24px -4px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);
  --shadow-lg:  0 8px 40px -8px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08);

  /* Duration */
  --duration-fast:   150ms;
  --duration-base:   250ms;
  --duration-slow:   400ms;

  /* Easing */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## Layer 2: Semantic Tokens

Purpose-based aliases. These are what components consume — never primitives directly.

```css
:root {
  /* Surface */
  --color-bg:        var(--color-paper-raw);     /* Page background */
  --color-surface:   var(--color-white-raw);     /* Card surfaces */
  --color-border:    var(--color-mist-raw);      /* Hairline borders */

  /* Text */
  --color-ink:       var(--color-ink-raw);       /* Primary text */
  --color-secondary: var(--color-charcoal-raw);  /* Secondary text */
  --color-tertiary:  var(--color-ash-raw);       /* Meta, captions */

  /* Accent */
  --color-accent:      var(--color-accent-raw);
  --color-accent-hover:var(--color-accent-deep-raw);
  --color-accent-dim:  oklch(60% 0.25 350 / 0.15); /* Magenta Whisper */
  --color-accent-veil: oklch(60% 0.25 350 / 0.25); /* Magenta Veil */

  /* Feedback */
  --color-error:    oklch(55% 0.22 27);
  --color-success:  oklch(55% 0.18 145);
  --color-warning:  oklch(72% 0.17 60);

  /* Spacing semantics */
  --spacing-component: var(--space-2);  /* 16px — within components */
  --spacing-section:   var(--space-6);  /* 48px — between sections */
}
```

---

## Layer 3: Component Tokens

Component-specific overrides referencing the semantic layer. Add only when a component genuinely deviates from the semantic defaults.

```css
:root {
  /* Primary CTA — see design-principles.md for full spec */
  --btn-primary-bg:       var(--color-ink);
  --btn-primary-fg:       var(--color-surface);
  --btn-primary-hover-bg: var(--color-accent);
  --btn-radius:           0;                    /* Sharp — editorial */

  /* Input */
  --input-border:         var(--color-border);
  --input-border-focus:   var(--color-accent);
  --input-focus-ring:     var(--color-accent-dim);
  --input-bg:             var(--color-surface);
  --input-radius:         0;

  /* Card */
  --card-border:          var(--color-border);
  --card-bg:              var(--color-surface);
  --card-padding:         var(--space-2);
  --card-shadow-hover:    var(--shadow-md);
  --card-radius:          0;                    /* Or --radius-sm for product register */
}
```

---

## Dark Mode

Override semantic tokens only — primitives stay unchanged.

```css
.dark {
  --color-bg:        var(--color-ink-raw);
  --color-surface:   oklch(15% 0.005 350);   /* Slightly warmer than pure black */
  --color-ink:       var(--color-white-raw);
  --color-secondary: var(--color-mist-raw);
  --color-tertiary:  var(--color-ash-raw);
  --color-border:    oklch(22% 0 0);
}
```

---

## Naming Convention

```
--{category}-{item}-{variant}-{state}

Examples:
--color-accent             # category-item
--color-accent-hover       # category-item-state
--btn-primary-hover-bg     # component-variant-state-property
--spacing-section          # category-semantic
```

## Antipattern: Flat Tokens

Before (flat — wrong):
```css
--button-primary-bg: oklch(10% 0 0);   /* Hard to theme */
```

After (three-layer — correct):
```css
/* Primitive */    --color-ink-raw: oklch(10% 0 0);
/* Semantic */     --color-ink:     var(--color-ink-raw);
/* Component */    --btn-primary-bg: var(--color-ink);
```

The three-layer structure means a rebrand only touches primitives. A theme switch (dark mode) only touches semantics. A component redesign only touches component tokens.

---

## File Organization

```
tokens/
├── primitives.css    # --color-X-raw, --space-N, --font-size-X
├── semantic.css      # --color-bg, --color-ink, --spacing-section
├── components.css    # --btn-*, --input-*, --card-*
└── index.css         # @import all three

/* Or single file with layer comments */
/* === PRIMITIVES === */
/* === SEMANTIC === */
/* === COMPONENTS === */
/* === DARK MODE === */
```

---

## Token Validation Rules

During `extract` and `document` workflows, flag:
- Raw hex or rgb() in component CSS — should be a token reference
- Repeated identical raw values — extract to primitive
- Semantic names that embed color names (`--color-blue-button`) — semantic names should describe role, not value
- Component tokens bypassing the semantic layer — breaks theming
