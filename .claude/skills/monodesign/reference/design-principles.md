# Design Principles — The Editorial Sanctuary

The north star aesthetic. Nine load-bearing rules that override project-specific decisions. When a project brief conflicts with these, the rules win.

## The Nine Rules

### 1. The One Voice Rule
Editorial Magenta is the only vibrant color. No supporting accent, ever. If a second emphasis point is needed, use scale or weight — never a second hue.

**Enforcement:** When you find yourself reaching for a second accent color, stop. Ask: can scale, weight, or spacing carry the emphasis instead?

### 2. The Paper-Not-White Rule
Page background is Warm Ash Cream (`oklch(96% 0.005 350)`), never Crisp Paper White (`oklch(98% 0 0)`). The warmth is load-bearing — it creates subconscious cohesion with the accent.

**Enforcement:** `background: white` and `background: #fff` are never acceptable as page-level backgrounds. Always use the Warm Ash Cream token.

### 3. The OKLCH-Only Rule
All new colors are declared in OKLCH. Hex is reserved only for the fenced Command Category Tints (the six category tag colors).

**Enforcement:** Color picking in hex, hsl, or rgb = disqualified. Write the OKLCH equivalent before shipping.

### 4. The Italic-Is-Voice Rule
Italic is a voice choice for display type, not emphasis inside body copy. Body emphasis is weight — `font-weight: 600` or `700`. Italic inside running text = wrong register.

**Enforcement:** `<em>` and `font-style: italic` inside paragraph elements = flag. Display headings in italic = intentional editorial voice.

### 5. The 1.6 Leading Rule
Body `line-height` is exactly `1.6` everywhere. Not `1.5`, not `1.7`. This is the load-bearing readability decision. Headings use tighter leading (`1.1`–`1.25`).

**Enforcement:** Check `line-height` on `body`, `p`, and long-copy elements. `1.6` is non-negotiable.

### 6. The Fluid-Headlines-Only Rule
Headings use `clamp()` fluid sizing. Body copy uses fixed `rem` values.

```css
/* Correct */
h1 { font-size: clamp(2rem, 5vw + 1rem, 4.5rem); }
h2 { font-size: clamp(1.5rem, 3vw + 0.75rem, 3rem); }
p  { font-size: 1rem; } /* fixed */

/* Wrong */
h1 { font-size: 4.5rem; } /* no clamp */
p  { font-size: clamp(0.875rem, 1vw, 1rem); } /* body shouldn't fluid-scale */
```

### 7. The Flat-By-Default Rule
Surfaces are flat at rest. Shadows appear only on hover or deliberate elevation. A surface with a resting shadow has skipped a design decision.

```css
/* Correct */
.card {
  box-shadow: none; /* flat at rest */
  transition: box-shadow 0.3s var(--ease-out);
}
.card:hover { box-shadow: var(--shadow-md); }

/* Wrong */
.card { box-shadow: 0 4px 20px rgba(0,0,0,0.15); } /* always elevated */
```

### 8. The Low-Alpha Rule
Every shadow's strongest blur uses ≤0.15 alpha. Higher alphas read as 2014 Material Design drop shadows.

```css
/* Correct */
--shadow-md: 0 4px 24px -4px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);

/* Wrong */
box-shadow: 0 10px 30px rgba(0,0,0,0.3); /* 0.3 alpha — too heavy */
```

### 9. The Tinted-Shadow-Only-For-Accent Rule
Neutral shadows (`rgba(0,0,0,...)`) for structure. Magenta-tinted shadows (`oklch(60% 0.25 350 / ...)`) only for deliberate accent-glow moments — not as defaults on any surface.

---

## Do / Don't Reference

**Do:**
- Treat Warm Ash Cream as the default page background
- Use Editorial Magenta on ≤10% of any given screen
- Set all new colors in OKLCH
- Use italic display type as a voice, not emphasis inside paragraphs
- Use `clamp()` fluid sizing for headings; fixed rem for body
- Keep the primary CTA sharp: `border-radius: 0`, uppercase, letter-tracked
- Use `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`) on all transitions
- Leave surfaces flat at rest — shadows only on hover or elevation
- Respect `prefers-reduced-motion` on every animation
- Cap body line length at 65–75ch via `max-width`

**Don't:**
- Use pure black (`#000`) or pure white (`#fff`)
- Use `border-left` or `border-right` > 1px as a colored stripe
- Use `background-clip: text` with a gradient
- Default to dark mode without a scene sentence that forces the answer
- Use glassmorphism decoratively
- Add a second accent color
- Use rounded rectangles with generic drop shadows
- Use bounce or elastic easing
- Animate layout properties (width, height, padding, margin)
- Nest cards inside cards

---

## Reference Color System

All colors in OKLCH. Named palette:

| Name | OKLCH | Role |
|---|---|---|
| Editorial Magenta | `oklch(60% 0.25 350)` | Primary CTA, active states, one accent |
| Editorial Magenta Deep | `oklch(52% 0.25 350)` | Hover/active state |
| Warm Ash Cream | `oklch(96% 0.005 350)` | Primary page background |
| Crisp Paper White | `oklch(98% 0 0)` | Inverted text moments, high-contrast surfaces |
| Deep Graphite | `oklch(10% 0 0)` | Primary text, CTA backgrounds |
| Soft Charcoal | `oklch(25% 0 0)` | Secondary text — taglines, hook paragraphs |
| Mid Ash | `oklch(55% 0 0)` | Tertiary — micro-labels, captions, meta |
| Paper Mist | `oklch(92% 0 0)` | Hairline borders, section dividers |
| Magenta Whisper | `oklch(60% 0.25 350 / 0.15)` | Diffuse glow on hover, selection highlights |
| Magenta Veil | `oklch(60% 0.25 350 / 0.25)` | Focus rings, emphasis shells |

### Editorial Magenta Tonal Ramp

```
oklch(22% 0.12 350)   ← darkest
oklch(32% 0.18 350)
oklch(42% 0.22 350)
oklch(52% 0.25 350)   ← hover
oklch(60% 0.25 350)   ← base
oklch(72% 0.18 350)
oklch(84% 0.10 350)
oklch(94% 0.04 350)   ← lightest
```

---

## Reference Typography System

| Style | Purpose | Notes |
|---|---|---|
| Display | Hero title only | Light italic — author-signature feel |
| Headline | Section headings | Larger editorial moments |
| Title | Hero tagline / section leads | Quieter second display voice |
| Body Lead | Opening paragraph of long copy | Slightly larger, medium weight |
| Body | Running copy | 1rem, 1.6 line-height, 65–75ch measure |
| Supporting | Captions, image credits | Smaller, recessed |
| Label / Micro-Label | UI labels, form labels, tags | Uppercase, tracked |
| Mono | Code, technical content | Space Grotesk |

---

## Reference Component Specifications

### Primary CTA
```css
.btn-primary {
  background-color: var(--color-ink);      /* Deep Graphite on light bg */
  color: var(--color-paper);
  font-family: var(--font-body);
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 0;                        /* sharp corners — editorial */
  padding: var(--space-4) var(--space-8);
  border: none;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out);
}

.btn-primary:hover {
  background-color: var(--color-accent);  /* Magenta on hover */
}
```

### Inline Text Link
```css
a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--color-accent-dim);
  text-underline-offset: 3px;
  transition: text-decoration-color var(--duration-fast) var(--ease-out);
}

a:hover {
  text-decoration-color: var(--color-accent);
}
```

### Site Navigation
```css
.nav-link {
  font-size: var(--font-size-sm);
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-ash);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-out);
}

.nav-link[aria-current="page"],
.nav-link:hover {
  color: var(--color-ink);
}
```

### Feature Card
- Flat at rest (`box-shadow: none`)
- Shadow appears on hover (`var(--shadow-md)`)
- `border: 1px solid var(--color-mist)` — always present
- No rounded corners on brand-register cards; `var(--radius-sm)` on product-register
- Content: title in Headline style, supporting text in Body, CTA in micro-label style

### Email Input
```html
<form class="email-form">
  <label for="email" class="sr-only">Email address</label>
  <input type="email" id="email" name="email" placeholder="you@example.com" 
         class="email-input" required>
  <button type="submit" class="btn-primary">Subscribe</button>
</form>
```

```css
.email-input {
  border: 1.5px solid var(--color-mist);
  border-radius: 0;    /* sharp, editorial */
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-base);
  background: var(--color-paper);
  color: var(--color-ink);
  transition: border-color var(--duration-fast) var(--ease-out);
}

.email-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-dim);
}
```
