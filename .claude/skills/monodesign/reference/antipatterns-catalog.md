<!-- Synced from impeccable v3.1.0 registry. Source of truth: cli/engine/registry/antipatterns.mjs -->
# Antipatterns Catalog

All 46 known design antipatterns with detection rules and remediation. These are what `npx impeccable detect` checks. Run this on any HTML/CSS target before presenting work.

## Categories

These are the two categories the `impeccable detect` engine uses:

- **slop** — AI tells that signal lack of intentional design (27 patterns)
- **quality** — Design principle violations including contrast, motion, readability, and semantic structure (19 patterns)

---

## Slop Antipatterns (AI Tells)

### `aphoristic-cadence` — Aphoristic-cadence copy

**Detect**: Three or more sections ending in a short rebuttal sentence ("X. No Y." / "X. Just Y.") or a manufactured-contrast aphorism ("Not a feature. A platform.").

**Why it's wrong**: Once is fine; the pattern is the tell. This AI cadence reads as manufactured voice, not genuine brand personality.

**Fix**: Replace manufactured contrast with specific, concrete language about what the product literally does. Vary sentence structure across sections.

### `ai-color-palette` — AI color palette
**Detect:** Purple or violet text on headings, purple gradient backgrounds, or violet accent colors not in the project's declared palette.  
**Why it's wrong:** Purple/violet as a default accent is the most saturated AI training-data reflex. It signals zero intentionality.  
**Fix:** Define a color strategy (restrained → drenched) and pick a hue from that strategy — not from "what looks techy."

### `border-accent-on-rounded` — Border accent on rounded element
**Detect:** `border-left/right` ≥ 2px combined with `border-radius` > 0 on the same element.  
**Why it's wrong:** A stripe on a pill reads as broken — the side border doesn't match the rounded corners. The composition is incoherent.  
**Fix:** Use a full border or background tint instead; if accent is needed, use a dot, icon, or colored chip.

### `bounce-easing` — Bounce or elastic easing
**Detect:** `cubic-bezier` with overshoot (second Y control point > 1 or < 0, e.g., `cubic-bezier(0.34, 1.56, 0.64, 1)`), or `animate-bounce` Tailwind class, or `spring` easing.  
**Why it's wrong:** Bounce easing is a 2013 trend that reads as playful-in-a-bad-way on professional interfaces. It also tends to cause layout shift.  
**Fix:** Use expo-out (`cubic-bezier(0.16, 1, 0.3, 1)`) for snappy exits, quint-out for softer landings. No overshoot.

### `cream-palette` — Cream / beige palette

**Detect**: Warm cream or beige page background (`#fdf6e3`, `#faf8f5`, or equivalent warm off-white) with no other distinguishing palette element.

**Why it's wrong**: A warm cream or beige background has become the default "tasteful" AI surface, reached for by reflex. It signals lack of a deliberate palette strategy.

**Fix**: Choose a background that comes from a deliberate palette. If warm neutrals are right for the project, commit to them intentionally with a full color strategy — not as a safe default.

### `dark-glow` — Dark mode with glowing accents
**Detect:** Colored glow (`box-shadow` or `filter: blur + color`) on colored elements against a dark (`oklch < 20%` or `#1x` hex) background.  
**Why it's wrong:** Neon glows on dark backgrounds are the most saturated sci-fi/crypto UI cliché. They scream AI-generated dark mode.  
**Fix:** Use subtle shadow lifts, border treatments, or opacity shifts on dark backgrounds. Glow should be exceptionally rare and intentional.

### `em-dash-overuse` — Em-dash overuse

**Detect**: More than two em-dashes (— or --) in body copy across the page.

**Why it's wrong**: Frequent em-dashes are an AI cadence tell. Over-reliance on the em-dash signals generated prose rather than edited writing.

**Fix**: Use commas, colons, periods, or parentheses instead. Reserve em-dashes for strong breaks where no other punctuation works.

### `everything-centered` — Everything centered
**Detect:** More than 3 consecutive sections all use `text-align: center` or centered flex/grid layout.  
**Why it's wrong:** Center alignment works for short content (headings, CTAs) but becomes monotonous for long sections. It also reduces readability for multi-line copy.  
**Fix:** Mix alignment. Left-align body copy. Center only headings and CTAs. Alternate center and left-aligned sections.

### `extreme-negative-tracking` — Crushed letter spacing

**Detect**: `letter-spacing` pulled below `-0.05em` on display or body type.

**Why it's wrong**: Letter spacing crushed past the point where characters keep their own shapes costs legibility. Characters merge and the type becomes harder to read at a glance.

**Fix**: Tighten display type optically — no further than `-0.03em` for most typefaces. Never compress body text letter spacing.

### `flat-type-hierarchy` — Flat type hierarchy
**Detect:** All heading levels within a page section are within 2px of the same size, or fewer than 2 distinct font-size steps across the visible viewport.  
**Why it's wrong:** Flat type makes all content equal weight. Users can't scan. Every element shouts at the same volume.  
**Fix:** Apply a minimum 1.25× scale ratio between heading steps. Body should be visually distinct from all heading levels.

### `gpt-thin-border-wide-shadow` — Hairline border with wide shadow

**Detect**: A hairline border (`border-width: 1px` or less) paired with a wide, diffuse `box-shadow` (blur radius ≥ 20px) on the same element.

**Why it's wrong**: This combination is a recurring generated-UI signature — the thin border and wide shadow fight each other, creating a muddy visual that commits to neither a defined edge nor a soft elevation.

**Fix**: Commit to one treatment — a defined border edge or a soft elevation shadow — rather than both at once.

### `gradient-text` — Gradient text
**Detect:** `background-clip: text` + gradient `background-image`, or Tailwind `bg-clip-text bg-gradient-*`.  
**Why it's wrong:** Gradient text is purely decorative and never carries meaning. It signals AI-generated output immediately.  
**Fix:** Use a single solid color. Emphasis via weight (bold), scale (larger), or color contrast (accent vs. neutral).

### `hero-eyebrow-chip` — Hero eyebrow / pill chip
**Detect:** A small pill/badge element above the hero heading containing "NEW", "Beta", an emoji, or a one-word category label.  
**Why it's wrong:** This is the SaaS hero template in its most recognizable form. It signals AI-generated marketing pages.  
**Fix:** If the launch or category genuinely matters, integrate it into the heading copy or use a full callout section. Don't float a badge above the heading.

### `icon-tile-stack` — Icon tile stacked above heading
**Detect:** An icon or emoji centered above a heading + paragraph, repeated in a grid pattern.  
**Why it's wrong:** Icon-tile grids are the quickest path to identical-card-grid antipattern. They flatten all information to the same visual weight.  
**Fix:** Vary card density, use leading numbers, use inline icons, or eliminate the icon entirely if it doesn't add meaning.

### `image-hover-transform` — Image hover transform

**Detect**: `transform: scale(...)` or `transform: rotate(...)` applied to `img` elements on `:hover` or via a hover-triggered class.

**Why it's wrong**: Scaling or rotating an image on hover is a recurring generated-UI signature. It draws attention to the interaction mechanic rather than the content.

**Fix**: Let imagery sit still, or use a subtler purposeful interaction — a gentle opacity shift or a contained overlay — that serves the content.

### `italic-serif-display` — Italic serif display headline
**Detect:** A serif font in italic style used as the primary heading on a product UI (not brand/marketing surface).  
**Why it's wrong:** Editorial serif-italic (Fraunces, Recoleta, Playfair, Newsreader-italic) is powerful on brand/landing surfaces but reads as mismatched on product UIs (dashboards, apps, settings). It has also become the universal AI-startup landing page hero.  
**Fix:** On product register surfaces, use a weight-contrast pair with a sans-serif. If using italic serif on a brand surface, judge by context — editorial/magazine register may legitimately want this.

### `marketing-buzzword` — Marketing buzzword

**Detect**: Generic SaaS phrases in body copy or headings: "streamline", "empower", "supercharge", "world-class", "enterprise-grade", "next-generation", "cutting-edge", "leverage", "revolutionize", "game-changing".

**Why it's wrong**: These are instant AI tells. They communicate nothing specific and signal copy generated by reflex rather than written for the product.

**Fix**: Pick a specific verb and noun that says what the product literally does. Replace "streamline your workflow" with the concrete action — "send invoices in two clicks."

### `monotonous-spacing` — Monotonous spacing
**Detect:** All `margin`, `padding`, or `gap` values across sibling elements are identical — no variation in rhythm.  
**Why it's wrong:** Same spacing everywhere is visual monotony. It removes cadence, making layouts feel like forms rather than compositions.  
**Fix:** Vary vertical spacing deliberately. Sections deserve more breathing room than components. Components deserve more than inline elements.

### `nested-cards` — Nested cards
**Detect:** A `.card` element (or equivalent with shadow + border-radius + border) that contains another `.card` element.  
**Why it's wrong:** Nested cards create a visual hierarchy that competes with itself and usually signals a structural decision that should be a section, list, or table instead.  
**Fix:** Flatten the nesting. Use a list for similar items; use a section divider for grouped content; use a table for structured data.

### `numbered-section-markers` — Numbered section markers (01 / 02 / 03)

**Detect**: Display markers like "01", "02", "03" used as section labels or visual counters above section headings.

**Why it's wrong**: Numbered display markers as section labels are the AI editorial scaffold one tier deeper than tracked eyebrow chips. They signal template-filling rather than deliberate structural choice.

**Fix**: If numbering genuinely serves the content (a step-by-step process), integrate it into the heading. Otherwise choose a different section cadence — imagery, whitespace variation, or typographic contrast.

### `overused-font` — Overused font
**Detect:** Font family is Inter, Roboto, Open Sans, Lato, Montserrat, Arial, Helvetica, Fraunces, Geist, Geist Sans, Geist Mono, Mona Sans, Plus Jakarta Sans, Space Grotesk, Recoleta, or Instrument Sans, with no customization of weight, optical size, or pairing.  
**Why it's wrong:** These are the most saturated AI-default and monoculture fonts. Using them without a strong visual concept makes designs interchangeable.  
**Fix:** Choose fonts with personality for the project. Inter is acceptable in product UIs when combined with a distinctive display font.

### `oversized-h1` — Oversized hero headline

**Detect**: A full-sentence headline (more than 6 words) set at display size (≥ 72px / ≥ 4.5rem) that dominates the above-fold viewport.

**Why it's wrong**: A long headline blown up to display size leaves no room for supporting content above the fold and creates a wall of text at an uncomfortable size. A punchy one- or two-word headline at that size is fine — the problem is long copy at display scale.

**Fix**: Set long headlines smaller, or tighten the copy to a punchy phrase that earns the display size.

### `repeated-section-kickers` — Repeated section kicker labels

**Detect**: Three or more page sections each open with a small uppercase tracked label (eyebrow / kicker) immediately above the section heading.

**Why it's wrong**: Repeating tiny uppercase tracked labels above section headings turns a brand page into AI editorial scaffolding. The structural repetition signals template-filling.

**Fix**: Replace with stronger structure, artifacts, imagery, or a deliberate brand system. Reserve eyebrow labels for sections where the category label genuinely aids navigation.

### `repeating-stripes-gradient` — Repeating-gradient stripes

**Detect**: `repeating-linear-gradient` or `repeating-conic-gradient` used as surface decoration (backgrounds, cards, dividers).

**Why it's wrong**: Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. They read as filler texture rather than intentional design.

**Fix**: Reach for a deliberate texture with cultural or brand meaning, or leave the surface plain.

### `side-tab` — Side-tab accent border
**Detect:** `border-left: Npx solid [color]` or `border-right: Npx solid [color]` > 1px on cards, list items, callouts, or alerts.  
**Why it's wrong:** This is the most recognizable AI-generated dashboard pattern. It substitutes a structural decision with a painted stripe.  
**Fix:** Use full borders, background tints, leading numbers or icons, or remove the accent entirely.

### `single-font` — Single font for everything
**Detect:** Only one `font-family` used across all type scales — heading, body, and UI elements.  
**Why it's wrong:** A single font at identical weights looks like a rough draft. Type contrast is one of the strongest design levers.  
**Fix:** Pair a display font (headings) with a text font (body). At minimum, vary weight aggressively (300 vs 700) between heading and body.

### `theater-slop-phrase` — Theater framing copy

**Detect**: The word "theater" used dismissively in copy — "security theater", "performance theater", "compliance theater" — as a rhetorical framing device.

**Why it's wrong**: Dismissing something as "theater" is a recurring generated-copy tic. It reads as borrowed critical voice rather than genuine analysis.

**Fix**: Say plainly what the thing does or does not do. Replace "security theater" with a specific claim about what the mechanism fails to prevent.

---

## Quality Antipatterns

### `all-caps-body` — All-caps body text
**Detect:** `text-transform: uppercase` on multi-word sentence-length (> 4 words) elements.  
**Why it's wrong:** All-caps in running text reduces reading speed by ~12% (Tinker, 1955). Reserved for micro-labels (≤ 3 words) and navigation items.  
**Fix:** Uppercase is valid for: button labels, navigation links, section eyebrows (≤ 3 words), form labels. Not for sentences.

### `body-text-viewport-edge` — Body text touching viewport edge

**Detect**: Body paragraphs render with no horizontal margin or padding from the viewport edge — computed left or right offset is less than 16px.

**Why it's wrong**: Text flush against the viewport edge has no breathing room and signals an unstyled or broken layout. It makes the content feel uncontained and is especially painful on narrow mobile viewports.

**Fix**: Wrap content in a container with at least 16px (ideally 24–32px) of horizontal padding, or apply `max-width` with `mx-auto` to center-constrain the content.

### `broken-image` — Broken or placeholder image

**Detect**: `<img>` tags with empty `src`, missing `src`, `src=""`, `src="#"`, or placeholder values like `placeholder.png`, `image.jpg`, `example.com/image`.

**Why it's wrong**: Broken image boxes ship as visible errors. They signal unfinished work and erode trust in the design.

**Fix**: Use real images, generated assets, or remove the `<img>` tag entirely. If a placeholder is needed during development, use a real placeholder service (`picsum.photos`, etc.) and flag it for replacement.

### `clipped-overflow-container` — Positioned child clipped by overflow container

**Detect**: An `overflow: hidden` or `overflow: clip` container that wraps an absolutely-positioned child element (tooltip, dropdown, popover, menu).

**Why it's wrong**: A clipping container cuts off tooltips, menus, and popovers that need to escape the bounds of their parent. The positioned layer renders invisibly clipped.

**Fix**: Let the overflow be visible on the clipping ancestor, or move the positioned layer out of the clip — render it in a portal at the document body level.

### `cramped-padding` — Cramped padding
**Detect:** `padding` inside interactive or card elements is ≤ 8px on any axis.  
**Why it's wrong:** Cramped elements are hard to read, harder to click, and communicate low quality. 8px is the absolute minimum; 16px is the default.  
**Fix:** Minimum 12px padding inside cards. Minimum 10px vertical + 16px horizontal on buttons. Minimum 44×44px touch targets.

### `design-system-color` — Color outside DESIGN.md

**Detect**: A literal color value used in CSS that is not declared in the project's `DESIGN.md` palette or its tonal ramps.

**Why it's wrong**: Colors outside the declared palette are design-system drift. Each undeclared color erodes the consistency of the system and makes future updates harder.

**Fix**: Use a documented palette token or update `DESIGN.md` if this color is an intentional brand addition. Distinguish intentional additions from accidental drift.

### `design-system-font` — Font outside DESIGN.md

**Detect**: A `font-family` used in CSS that is not declared in the project's `DESIGN.md` typography section.

**Why it's wrong**: Undeclared fonts are type-system drift. They break typographic consistency and signal unreviewed additions outside the design system.

**Fix**: Use the documented type system or update `DESIGN.md` if this is an intentional brand addition. Never silently add a typeface without updating the system.

### `design-system-radius` — Radius outside DESIGN.md

**Detect**: A `border-radius` value used in CSS that is not in the project's `DESIGN.md` rounded-corner scale.

**Why it's wrong**: Undeclared radius values erode the consistency of the shape system. Mixed corner radii make a UI feel unpolished and assembled from parts.

**Fix**: Use a documented radius token or update the design system if the new shape is intentional.

### `gray-on-color` — Gray text on colored background
**Detect:** A gray text color (`oklch < 70% chroma < 0.05`) rendered on a colored (chroma > 0.1) background.  
**Why it's wrong:** Gray text on colored backgrounds almost always fails WCAG contrast requirements and looks muddy.  
**Fix:** Use white or the appropriate neutral from the color ramp. Never use a generic gray on a tinted background.

### `justified-text` — Justified text
**Detect:** `text-align: justify` on paragraph elements.  
**Why it's wrong:** CSS text justification creates uneven word spacing (rivers of white) because browsers don't hyphenate automatically. It reads as broken on web.  
**Fix:** Use `text-align: left` for body copy, `text-align: center` for short headings only.

### `layout-transition` — Layout property animation
**Detect:** `transition: width`, `transition: height`, `transition: padding`, or `transition: margin` on any element.  
**Why it's wrong:** Layout property animation triggers reflow on every frame, causing jank on low-powered devices.  
**Fix:** Animate only `transform` and `opacity`. For expanding elements, use `max-height` + `opacity` with caution, or clip-path for reveal animations.

### `line-length` — Line length too long
**Detect:** `max-width` not set on `p` or body-copy containers, or line length exceeding ~80ch based on font-size and container width.  
**Why it's wrong:** Long lines reduce reading speed and comprehension. 65–75ch is optimal for Latin script.  
**Fix:** Apply `max-width: 65ch` to paragraph elements, or `max-width: 680px` as a safe value for 16–18px body text.

### `low-contrast` — Low contrast text
**Detect:** Text color does not achieve 4.5:1 contrast ratio against its background for normal text, or 3:1 for large text (18px+ regular or 14px+ bold), as measured by the WCAG relative luminance formula.  
**Why it's wrong:** Low contrast text fails WCAG AA requirements and creates genuine barriers for users with low vision, in bright ambient light, or on low-quality displays.  
**Fix:** Increase the contrast between text and background. Use white or a high-lightness neutral on dark backgrounds; use Deep Graphite (`oklch(10% 0 0)`) or Soft Charcoal (`oklch(25% 0 0)`) on light ones. Tool: check with `npx impeccable detect` or the WebAIM contrast checker.

### `pure-black-white` — Pure black or white background
**Detect:** `background: #000`, `background: #000000`, or `background: black` on any surface.  
**Why it's wrong:** Pure black reads as low quality on most displays. Tinted dark (e.g., `oklch(8% 0.005 350)`) reads as intentional.  
**Fix:** Tint every neutral toward the brand hue. Chroma 0.003–0.01 is enough to remove pure-black/pure-white.

### `skipped-heading` — Skipped heading level
**Detect:** An `h3` or deeper element that is not preceded by an `h2` in the same section, or an `h2` not preceded by an `h1`.  
**Why it's wrong:** Skipped headings break screen reader navigation and document outline semantics.  
**Fix:** Maintain sequential heading hierarchy. If you need the visual size of `h3` without the `h2` parent, use a `h2` with class-based styling.

### `text-overflow` — Content overflowing its container

**Detect**: Content renders wider than its container — `scrollWidth > clientWidth` on any non-scroll element, or a horizontal scrollbar appears on the page.

**Why it's wrong**: Content spilling out of its container forces a horizontal scrollbar and signals a broken layout. It is especially disruptive on mobile viewports.

**Fix**: Let text wrap with `overflow-wrap: break-word`, constrain widths explicitly, or give the region a deliberate scroll affordance with `overflow-x: auto`.

### `tight-leading` — Tight line height
**Detect:** `line-height` < 1.4 on paragraph or body-copy elements.  
**Why it's wrong:** Tight leading makes multi-line copy hard to track. The eye loses the line.  
**Fix:** Body copy is `line-height: 1.6`. Long-form article content can go to `1.7`. Headings can use `1.1`–`1.25`.

### `tiny-text` — Tiny body text
**Detect:** `font-size` < 14px on paragraph or body-copy elements.  
**Why it's wrong:** Text below 14px fails readability standards for most users, especially at 96–120% zoom.  
**Fix:** Body copy minimum is 16px (`1rem`). Supporting text (captions, labels) minimum is 13px (0.8125rem).

### `wide-tracking` — Wide letter spacing on body text
**Detect:** `letter-spacing` > 0.05em on paragraph elements.  
**Why it's wrong:** Wide tracking on running text creates the "design-y" look at the cost of readability. Tracking belongs on display type and caps, not body.  
**Fix:** Body copy `letter-spacing: 0` (default) or at most `0.01em`. Track only micro-labels, buttons, and uppercase elements.

---

## Quick Reference Table

| ID | Category | Quick fix |
|---|---|---|
| `aphoristic-cadence` | slop | Specific language, not manufactured contrast |
| `ai-color-palette` | slop | Declare a color strategy |
| `border-accent-on-rounded` | slop | Full border or background tint |
| `bounce-easing` | slop | expo-out curve |
| `cream-palette` | slop | Deliberate palette, not default warm off-white |
| `dark-glow` | slop | Shadow lift + border |
| `em-dash-overuse` | slop | Commas, colons, periods instead |
| `everything-centered` | slop | Mix alignment |
| `extreme-negative-tracking` | slop | No tighter than -0.03em |
| `flat-type-hierarchy` | slop | 1.25× scale minimum |
| `gpt-thin-border-wide-shadow` | slop | Border or shadow — not both |
| `gradient-text` | slop | Solid color + weight |
| `hero-eyebrow-chip` | slop | Integrate into copy |
| `icon-tile-stack` | slop | Vary density or remove icons |
| `image-hover-transform` | slop | Subtle opacity or no interaction |
| `italic-serif-display` | slop | Sans on product register |
| `marketing-buzzword` | slop | Specific verb + noun |
| `monotonous-spacing` | slop | Vary rhythm deliberately |
| `nested-cards` | slop | Flatten to list or section |
| `numbered-section-markers` | slop | Different section cadence |
| `overused-font` | slop | Choose fonts with personality |
| `oversized-h1` | slop | Shorter copy or smaller size |
| `repeated-section-kickers` | slop | Stronger structure or imagery |
| `repeating-stripes-gradient` | slop | Deliberate texture or plain surface |
| `side-tab` | slop | Full border or background tint |
| `single-font` | slop | Pair display + text font |
| `theater-slop-phrase` | slop | Say what it does or doesn't do |
| `all-caps-body` | quality | Capitalize only ≤3 word labels |
| `body-text-viewport-edge` | quality | 16–32px horizontal padding |
| `broken-image` | quality | Real image or remove tag |
| `clipped-overflow-container` | quality | Portal or visible overflow |
| `cramped-padding` | quality | 16px minimum |
| `design-system-color` | quality | Use palette token or update DESIGN.md |
| `design-system-font` | quality | Use type system or update DESIGN.md |
| `design-system-radius` | quality | Use radius token or update DESIGN.md |
| `gray-on-color` | quality | White or appropriate ramp tone |
| `justified-text` | quality | text-align: left |
| `layout-transition` | quality | transform + opacity only |
| `line-length` | quality | max-width: 65ch |
| `low-contrast` | quality | 4.5:1 normal, 3:1 large text |
| `pure-black-white` | quality | Tinted neutral (chroma 0.005) |
| `skipped-heading` | quality | Sequential h1→h2→h3 |
| `text-overflow` | quality | overflow-wrap + constrained widths |
| `tight-leading` | quality | line-height: 1.6 |
| `tiny-text` | quality | 16px minimum body |
| `wide-tracking` | quality | letter-spacing: 0 on body |
