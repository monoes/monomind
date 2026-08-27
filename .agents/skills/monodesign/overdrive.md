---
name: monodesign-overdrive
description: Push an interface past conventional limits — cinematic page transitions, GPU-accelerated data visualization, physics-based interactions, generative art, extraordinary technical effects that make users say "wow".
type: design-sub-command
argument-hint: "[target interface or specific effect goal]"
user-invocable: true
---

# Monodesign: Overdrive

Push an interface past conventional limits.

**Start your response with:**
```
──────────── ⚡ OVERDRIVE ─────────────
》》》 Entering overdrive mode...
```

Read `reference/overdrive.md` from the monodesign skill directory for the full protocol.

## Context Determines "Extraordinary"

A particle system on a creative portfolio is impressive. The same particle system on a settings page is embarrassing. Before choosing a technique, ask: **what would make a user of THIS specific interface say "wow, that's nice"?**

- **Visual/marketing surfaces**: sensory — scroll-driven reveals, shader backgrounds, cinematic page transitions, generative art responding to cursor
- **Functional UI**: felt — dialog morphing from its trigger via View Transitions, data table rendering 100k rows at 60fps via virtual scrolling, form with streaming validation that feels instant, drag-and-drop with spring physics
- **Performance-critical UI**: invisible — search that filters 50k items without a flicker, image editor that processes near-real-time
- **Data-heavy interfaces**: fluid — GPU-accelerated rendering via Canvas/WebGL, animated transitions between data states

**The common thread**: something about the implementation goes beyond what users expect from a web interface. The technique serves the experience.

## Propose Before Building

Do NOT jump straight to implementation. You MUST:

1. Think through **2–3 different directions**: technique, level of ambition, aesthetic approach
2. **Ask the user** to pick before writing code. Explain trade-offs (browser support, performance cost, complexity)
3. Only proceed with the confirmed direction

## The Toolkit

**Cinematic transitions**: View Transitions API, shared element transitions, `::view-transition-group`

**Scroll-driven**: `animation-timeline: scroll()`, Intersection Observer with CSS transitions, parallax via transform

**Generative/ambient**: CSS custom properties + JS, Canvas 2D for simple generative art, WebGL/Three.js for shaders

**Physics**: spring animations via motion.dev, GSAP with ease functions, Popmotion

**Data at scale**: virtual scrolling (TanStack Virtual), Canvas/WebGL rendering, Web Workers for computation

**GPU compositing**: `transform` + `opacity` only, `will-change` on animated layers, `contain: strict` for isolation

## Iterate in Browser

Technically ambitious effects almost never look right on the first try. Use browser automation to watch the effect play. Expect multiple rounds of refinement. The gap between "technically works" and "looks extraordinary" is closed through visual iteration, not code alone.
