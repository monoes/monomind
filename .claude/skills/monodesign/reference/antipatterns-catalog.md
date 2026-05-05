# Antipatterns Catalog

All 27 known design antipatterns with detection rules and remediation. These are what `npx impeccable detect` checks. Run this on any HTML/CSS target before presenting work.

## Categories

These are the two categories the `impeccable detect` engine uses:

- **slop** — AI tells that signal lack of intentional design (15 patterns)
- **quality** — Design principle violations including contrast, motion, readability, and semantic structure (12 patterns)

---

## Slop Antipatterns (AI Tells)

### `side-tab` — Side-tab accent border
**Detect:** `border-left: Npx solid [color]` or `border-right: Npx solid [color]` > 1px on cards, list items, callouts, or alerts.  
**Why it's wrong:** This is the most recognizable AI-generated dashboard pattern. It substitutes a structural decision with a painted stripe.  
**Fix:** Use full borders, background tints, leading numbers or icons, or remove the accent entirely.

### `border-accent-on-rounded` — Border accent on rounded element
**Detect:** `border-left/right` ≥ 2px combined with `border-radius` > 0 on the same element.  
**Why it's wrong:** A stripe on a pill reads as broken — the side border doesn't match the rounded corners. The composition is incoherent.  
**Fix:** Use a full border or background tint instead; if accent is needed, use a dot, icon, or colored chip.

### `gradient-text` — Gradient text
**Detect:** `background-clip: text` + gradient `background-image`, or Tailwind `bg-clip-text bg-gradient-*`.  
**Why it's wrong:** Gradient text is purely decorative and never carries meaning. It signals AI-generated output immediately.  
**Fix:** Use a single solid color. Emphasis via weight (bold), scale (larger), or color contrast (accent vs. neutral).

### `ai-color-palette` — AI color palette
**Detect:** Purple or violet text on headings, purple gradient backgrounds, or violet accent colors not in the project's declared palette.  
**Why it's wrong:** Purple/violet as a default accent is the most saturated AI training-data reflex. It signals zero intentionality.  
**Fix:** Define a color strategy (restrained → drenched) and pick a hue from that strategy — not from "what looks techy."

### `icon-tile-stack` — Icon tile stacked above heading
**Detect:** An icon or emoji centered above a heading + paragraph, repeated in a grid pattern.  
**Why it's wrong:** Icon-tile grids are the quickest path to identical-card-grid antipattern. They flatten all information to the same visual weight.  
**Fix:** Vary card density, use leading numbers, use inline icons, or eliminate the icon entirely if it doesn't add meaning.

### `hero-eyebrow-chip` — Hero eyebrow / pill chip
**Detect:** A small pill/badge element above the hero heading containing "NEW", "Beta", an emoji, or a one-word category label.  
**Why it's wrong:** This is the SaaS hero template in its most recognizable form. It signals AI-generated marketing pages.  
**Fix:** If the launch or category genuinely matters, integrate it into the heading copy or use a full callout section. Don't float a badge above the heading.

### `dark-glow` — Dark mode with glowing accents
**Detect:** Colored glow (`box-shadow` or `filter: blur + color`) on colored elements against a dark (`oklch < 20%` or `#1x` hex) background.  
**Why it's wrong:** Neon glows on dark backgrounds are the most saturated sci-fi/crypto UI cliché. They scream AI-generated dark mode.  
**Fix:** Use subtle shadow lifts, border treatments, or opacity shifts on dark backgrounds. Glow should be exceptionally rare and intentional.

### `nested-cards` — Nested cards
**Detect:** A `.card` element (or equivalent with shadow + border-radius + border) that contains another `.card` element.  
**Why it's wrong:** Nested cards create a visual hierarchy that competes with itself and usually signals a structural decision that should be a section, list, or table instead.  
**Fix:** Flatten the nesting. Use a list for similar items; use a section divider for grouped content; use a table for structured data.

---

## Quality Antipatterns

### `flat-type-hierarchy` — Flat type hierarchy
**Detect:** All heading levels within a page section are within 2px of the same size, or fewer than 2 distinct font-size steps across the visible viewport.  
**Why it's wrong:** Flat type makes all content equal weight. Users can't scan. Every element shouts at the same volume.  
**Fix:** Apply a minimum 1.25× scale ratio between heading steps. Body should be visually distinct from all heading levels.

### `monotonous-spacing` — Monotonous spacing
**Detect:** All `margin`, `padding`, or `gap` values across sibling elements are identical — no variation in rhythm.  
**Why it's wrong:** Same spacing everywhere is visual monotony. It removes cadence, making layouts feel like forms rather than compositions.  
**Fix:** Vary vertical spacing deliberately. Sections deserve more breathing room than components. Components deserve more than inline elements.

### `cramped-padding` — Cramped padding
**Detect:** `padding` inside interactive or card elements is ≤ 8px on any axis.  
**Why it's wrong:** Cramped elements are hard to read, harder to click, and communicate low quality. 8px is the absolute minimum; 16px is the default.  
**Fix:** Minimum 12px padding inside cards. Minimum 10px vertical + 16px horizontal on buttons. Minimum 44×44px touch targets.

### `everything-centered` — Everything centered
**Detect:** More than 3 consecutive sections all use `text-align: center` or centered flex/grid layout.  
**Why it's wrong:** Center alignment works for short content (headings, CTAs) but becomes monotonous for long sections. It also reduces readability for multi-line copy.  
**Fix:** Mix alignment. Left-align body copy. Center only headings and CTAs. Alternate center and left-aligned sections.

### `pure-black-white` — Pure black or white background
**Detect:** `background: #000`, `background: #000000`, or `background: black` on any surface.  
**Why it's wrong:** Pure black reads as low quality on most displays. Tinted dark (e.g., `oklch(8% 0.005 350)`) reads as intentional.  
**Fix:** Tint every neutral toward the brand hue. Chroma 0.003–0.01 is enough to remove pure-black/pure-white.

### `gray-on-color` — Gray text on colored background
**Detect:** A gray text color (`oklch < 70% chroma < 0.05`) rendered on a colored (chroma > 0.1) background.  
**Why it's wrong:** Gray text on colored backgrounds almost always fails WCAG contrast requirements and looks muddy.  
**Fix:** Use white or the appropriate neutral from the color ramp. Never use a generic gray on a tinted background.

### `bounce-easing` — Bounce or elastic easing
**Detect:** `cubic-bezier` with overshoot (second Y control point > 1 or < 0, e.g., `cubic-bezier(0.34, 1.56, 0.64, 1)`), or `animate-bounce` Tailwind class, or `spring` easing.  
**Why it's wrong:** Bounce easing is a 2013 trend that reads as playful-in-a-bad-way on professional interfaces. It also tends to cause layout shift.  
**Fix:** Use expo-out (`cubic-bezier(0.16, 1, 0.3, 1)`) for snappy exits, quint-out for softer landings. No overshoot.

### `layout-transition` — Layout property animation
**Detect:** `transition: width`, `transition: height`, `transition: padding`, or `transition: margin` on any element.  
**Why it's wrong:** Layout property animation triggers reflow on every frame, causing jank on low-powered devices.  
**Fix:** Animate only `transform` and `opacity`. For expanding elements, use `max-height` + `opacity` with caution, or clip-path for reveal animations.

---

## Typography Antipatterns

### `line-length` — Line length too long
**Detect:** `max-width` not set on `p` or body-copy containers, or line length exceeding ~80ch based on font-size and container width.  
**Why it's wrong:** Long lines reduce reading speed and comprehension. 65–75ch is optimal for Latin script.  
**Fix:** Apply `max-width: 65ch` to paragraph elements, or `max-width: 680px` as a safe value for 16–18px body text.

### `tight-leading` — Tight line height
**Detect:** `line-height` < 1.4 on paragraph or body-copy elements.  
**Why it's wrong:** Tight leading makes multi-line copy hard to track. The eye loses the line.  
**Fix:** Body copy is `line-height: 1.6`. Long-form article content can go to `1.7`. Headings can use `1.1`–`1.25`.

### `justified-text` — Justified text
**Detect:** `text-align: justify` on paragraph elements.  
**Why it's wrong:** CSS text justification creates uneven word spacing (rivers of white) because browsers don't hyphenate automatically. It reads as broken on web.  
**Fix:** Use `text-align: left` for body copy, `text-align: center` for short headings only.

### `tiny-text` — Tiny body text
**Detect:** `font-size` < 14px on paragraph or body-copy elements.  
**Why it's wrong:** Text below 14px fails readability standards for most users, especially at 96–120% zoom.  
**Fix:** Body copy minimum is 16px (`1rem`). Supporting text (captions, labels) minimum is 13px (0.8125rem).

### `all-caps-body` — All-caps body text
**Detect:** `text-transform: uppercase` on multi-word sentence-length (> 4 words) elements.  
**Why it's wrong:** All-caps in running text reduces reading speed by ~12% (Tinker, 1955). Reserved for micro-labels (≤ 3 words) and navigation items.  
**Fix:** Uppercase is valid for: button labels, navigation links, section eyebrows (≤ 3 words), form labels. Not for sentences.

### `wide-tracking` — Wide letter spacing on body text
**Detect:** `letter-spacing` > 0.05em on paragraph elements.  
**Why it's wrong:** Wide tracking on running text creates the "design-y" look at the cost of readability. Tracking belongs on display type and caps, not body.  
**Fix:** Body copy `letter-spacing: 0` (default) or at most `0.01em`. Track only micro-labels, buttons, and uppercase elements.

---

## Typography / Structure

### `overused-font` — Overused font
**Detect:** Font family is Inter, Roboto, Open Sans, Lato, Montserrat, Fraunces, Geist, Plus Jakarta Sans, Space Grotesk, or Instrument Sans, with no customization of weight, optical size, or pairing.  
**Why it's wrong:** These are the most saturated AI-default fonts. Using them without a strong visual concept makes designs interchangeable.  
**Fix:** Choose fonts with personality for the project. Inter is acceptable in product UIs when combined with a distinctive display font.

### `single-font` — Single font for everything
**Detect:** Only one `font-family` used across all type scales — heading, body, and UI elements.  
**Why it's wrong:** A single font at identical weights looks like a rough draft. Type contrast is one of the strongest design levers.  
**Fix:** Pair a display font (headings) with a text font (body). At minimum, vary weight aggressively (300 vs 700) between heading and body.

### `skipped-heading` — Skipped heading level
**Detect:** An `h3` or deeper element that is not preceded by an `h2` in the same section, or an `h2` not preceded by an `h1`.  
**Why it's wrong:** Skipped headings break screen reader navigation and document outline semantics.  
**Fix:** Maintain sequential heading hierarchy. If you need the visual size of `h3` without the `h2` parent, use a `h2` with class-based styling.

### `italic-serif-display` — Italic serif display headline
**Detect:** A serif font in italic style used as the primary heading on a product UI (not brand/marketing surface).  
**Why it's wrong:** Editorial serif-italic is powerful on brand/landing surfaces but reads as mismatched on product UIs (dashboards, apps, settings).  
**Fix:** On product register surfaces, use a weight-contrast pair with a sans-serif. Italic serif display belongs in the brand register only.

### `low-contrast` — Low contrast text
**Detect:** Text color does not achieve 4.5:1 contrast ratio against its background for normal text, or 3:1 for large text (18px+ regular or 14px+ bold), as measured by the WCAG relative luminance formula.  
**Why it's wrong:** Low contrast text fails WCAG AA requirements and creates genuine barriers for users with low vision, in bright ambient light, or on low-quality displays.  
**Fix:** Increase the contrast between text and background. Use white or a high-lightness neutral on dark backgrounds; use Deep Graphite (`oklch(10% 0 0)`) or Soft Charcoal (`oklch(25% 0 0)`) on light ones. Tool: check with `npx impeccable detect` or the WebAIM contrast checker.

---

## Quick Reference Table

| ID | Category | Quick fix |
|---|---|---|
| `side-tab` | slop | Full border or background tint |
| `border-accent-on-rounded` | slop | Full border or background tint |
| `gradient-text` | slop | Solid color + weight |
| `ai-color-palette` | slop | Declare a color strategy |
| `icon-tile-stack` | slop | Vary density or remove icons |
| `hero-eyebrow-chip` | slop | Integrate into copy |
| `dark-glow` | slop | Shadow lift + border |
| `nested-cards` | slop | Flatten to list or section |
| `flat-type-hierarchy` | slop | 1.25× scale minimum |
| `monotonous-spacing` | quality | Vary rhythm deliberately |
| `cramped-padding` | quality | 16px minimum |
| `everything-centered` | quality | Mix alignment |
| `pure-black-white` | quality | Tinted neutral (chroma 0.005) |
| `gray-on-color` | quality | White or appropriate ramp tone |
| `bounce-easing` | quality | expo-out curve |
| `layout-transition` | quality | transform + opacity only |
| `line-length` | quality | max-width: 65ch |
| `tight-leading` | quality | line-height: 1.6 |
| `justified-text` | quality | text-align: left |
| `tiny-text` | quality | 16px minimum body |
| `all-caps-body` | quality | Capitalize only ≤3 word labels |
| `wide-tracking` | quality | letter-spacing: 0 on body |
| `overused-font` | slop | Choose fonts with personality |
| `single-font` | slop | Pair display + text font |
| `skipped-heading` | quality | Sequential h1→h2→h3 |
| `italic-serif-display` | slop | Sans on product register |
| `low-contrast` | quality | 4.5:1 normal, 3:1 large text |
