# Pre-Delivery Checklist

Final-gate check before shipping any UI. Run through all sections that apply to the work.

For the full rule explanations behind each item, see `ux-rules.md`.

---

## Visual Quality

- [ ] No emojis used as icons — SVG icons only (Heroicons, Lucide, Phosphor)
- [ ] All icons from one consistent family with consistent stroke weight
- [ ] Pressed/hover states do not shift layout bounds or cause visual jitter
- [ ] Semantic color tokens used — no hard-coded hex values in components
- [ ] One visual style across all pages; no drift between sections
- [ ] Page background is Warm Ash Cream (`oklch(96% 0.005 350)`) — never pure white or `#fff`
- [ ] Editorial Magenta used on ≤10% of any given screen
- [ ] All colors declared in OKLCH

## Typography

- [ ] Body `line-height: 1.6` everywhere
- [ ] `max-width: 65ch` on all paragraph containers
- [ ] Body font size minimum 16px
- [ ] Headings use `clamp()` fluid sizing; body uses fixed `rem`
- [ ] Font weight hierarchy: headings 600–700, body 400, labels 500
- [ ] No italic inside running body copy (italic is display voice only)
- [ ] Type hierarchy: minimum 1.25× scale ratio between heading steps

## Interaction

- [ ] All interactive elements provide clear hover/pressed feedback
- [ ] `cursor: pointer` on clickable elements
- [ ] `touch-action: manipulation` to remove 300ms tap delay
- [ ] Disabled states: reduced opacity (0.38–0.5) + cursor change + semantic attribute
- [ ] Buttons disable and show loading state during async operations
- [ ] Screen reader focus order matches visual order
- [ ] All interactive elements have accessible labels (aria-label or visible text)

## Layout & Spacing

- [ ] `width=device-width, initial-scale=1` viewport meta (never disable zoom)
- [ ] No horizontal scroll on mobile
- [ ] Spacing follows 8/16/24/32/48/80/120 scale — no arbitrary values
- [ ] Fixed navbars reserve padding so content is not obscured
- [ ] Consistent max-width on desktop (max-w-6xl or 7xl)
- [ ] Z-index follows defined scale (0 / 10 / 20 / 40 / 100 / 1000)

## Accessibility

- [ ] All text meets 4.5:1 contrast ratio against its background (3:1 for large text)
- [ ] Visible focus rings on all interactive elements — never `outline: none` without replacement
- [ ] `alt` text on all meaningful images; `alt=""` on decorative
- [ ] Sequential heading hierarchy (h1 → h2 → h3, no skips)
- [ ] Color is never the only indicator — icon or text accompanies functional color
- [ ] `@media (prefers-reduced-motion: reduce)` wraps all animations
- [ ] Form inputs have `<label>` elements — no placeholder-as-label

## Animation

- [ ] Animation durations 150–300ms for micro-interactions; ≤400ms for complex transitions
- [ ] Only `transform` and `opacity` animated — never width/height/padding/margin
- [ ] Animations are interruptible — user action cancels in-progress animation
- [ ] `ease-out` on enter; `ease-in` on exit; never `linear` for UI transitions
- [ ] At most 1–2 animated elements per view
- [ ] Bounce/elastic easing is absent — use `cubic-bezier(0.16, 1, 0.3, 1)` for snappy

## Forms

- [ ] Visible label for every input
- [ ] Error messages appear below the relevant field
- [ ] Required fields indicated (asterisk + sr-only explanation)
- [ ] Inline validation runs on blur, not on keystroke
- [ ] Password fields have show/hide toggle
- [ ] Multi-step flows show step indicator and allow back navigation
- [ ] Submit button disables and shows progress during async operations

## Performance

- [ ] Images use WebP/AVIF with `srcset`
- [ ] `width` and `height` declared on images (prevents CLS)
- [ ] `font-display: swap` on web fonts
- [ ] Lists of 50+ items are virtualized
- [ ] Skeleton/shimmer for operations >1s

## Design Antipatterns (Quick Sweep)

Run `npx impeccable detect` or manually check:

- [ ] No `border-left: Npx solid [color]` as a stripe on cards (`side-tab`)
- [ ] No `background-clip: text` gradient text (`gradient-text`)
- [ ] No purple/violet as a default accent (`ai-color-palette`)
- [ ] No nested cards (`nested-cards`)
- [ ] No center alignment on more than 3 consecutive sections (`everything-centered`)
- [ ] No bounce/elastic easing (`bounce-easing`)
- [ ] No single font for everything — heading + body pair (`single-font`)
- [ ] No justified text (`justified-text`)
- [ ] No `text-transform: uppercase` on body copy longer than 3 words (`all-caps-body`)

---

## Before Handing Off

**The removal test:** Take out the most prominent effect or animation. Does the experience feel diminished, or does nobody notice? If nobody notices, remove it.

**The accessibility test:** Enable reduced motion. Is it still beautiful and fully functional?

**The contrast test:** View the page in grayscale. Is all content still readable and hierarchy clear?
