---
name: monodesign-animate
description: Add intentional, purposeful motion to interfaces — scroll-driven reveals, state transitions, micro-interactions, page transitions, and advanced motion effects using CSS and JS libraries.
type: design-sub-command
argument-hint: "[target component or page]"
user-invocable: true
---

# Monodesign: Animate

Add intentional motion to interfaces. Every animation must earn its place. Read `reference/animate.md` and `reference/motion-design.md` from the monodesign skill directory for the full protocol.

## Motion Rules (non-negotiable)

- **Do not animate CSS layout properties** (width, height, padding, margin, top, left) unless truly needed — causes layout thrashing
- **Ease out with exponential curves**: ease-out-quart / quint / expo. No bounce, no elastic
- **`prefers-reduced-motion` is not optional** — every animation needs a fallback (typically crossfade or instant transition)
- **Reveal animations must enhance an already-visible default** — don't gate content visibility on a class-triggered transition; content ships blank if the transition doesn't fire
- Use libraries for advanced motion (motion.dev, GSAP, anime.js, Lenis for smooth scroll)
- Staggering items in one list is legitimate — uniform section fades on every section are not

## Motion Premium Materials

Not just transform/opacity. When they materially improve the effect and stay smooth:
- Blur, backdrop-filter
- clip-path, mask
- shadow/glow transitions
- View Transitions API for page/component morphing

## Animation Categories

**Entrance/reveal** — elements entering the viewport or DOM. Use IntersectionObserver + CSS transitions. Keep under 400ms. Stagger lists (50–80ms per item).

**State transitions** — loading, success, error, empty. Should feel instantaneous for actions the user triggered. Confirmation animations: 200–400ms.

**Micro-interactions** — button press feedback, toggle switches, checkbox check marks. Sub-200ms. Should feel physical.

**Page/route transitions** — View Transitions API when available. Morphing elements from one state to another feels cinematic without heavy libraries.

**Ambient/background** — scroll-driven effects, parallax, cursor-tracking. Use `animation-timeline: scroll()` for pure CSS scroll-driven. Performance-test before shipping.

## Implementation Pattern

```css
/* Always start with the safe version */
@media (prefers-reduced-motion: no-preference) {
  .element {
    animation: slide-in 400ms ease-out-quart both;
  }
}

/* Explicit reduced-motion fallback */
@media (prefers-reduced-motion: reduce) {
  .element {
    animation: fade-in 200ms ease both;
  }
}
```

## Verify in Browser

Use browser automation to watch the animation play. Check:
- Does it look smooth at 60fps?
- Does the timing feel right (not too fast, not too slow)?
- Does the reduced-motion version make sense?
