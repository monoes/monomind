---
name: monomotion
description: HTML-native animation system using GSAP — timeline-driven, API-controllable animations that run in the browser without video rendering or React. Covers timeline control, WebSocket/REST-driven playback, effects, and sequencing.
version: 1.0.0
triggers:
  - /monomotion
  - /animate
  - /animation
  - make an animation
  - create an animation
  - add animation
  - build animation
  - animate this
  - animate the
  - web animation
  - html animation
  - browser animation
  - motion graphics
  - animated ui
  - timeline animation
  - gsap
  - control animation
  - api animation
  - animate via api
  - playback control
  - animation controller
  - animated intro
  - animated outro
  - transition animation
  - scroll animation
  - text animation
  - svg animation
  - animate on scroll
tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Monomotion — HTML Animation with GSAP

API-controllable, HTML-native animation using GSAP. No React, no video rendering — animations run live in the browser and are fully controllable via JavaScript API, WebSocket, or REST.

## Core Philosophy

- Animations are **timelines** — sequences of tweens with precise timing
- Timelines are **pausable, seekable, reversible** at any point
- Control surfaces (API, WebSocket, UI) are **decoupled** from animation definitions
- CSS transitions and keyframes are **not used** — GSAP owns all motion

## Setup

```html
<!-- CDN — drop into any HTML file -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>

<!-- With ScrollTrigger plugin -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>
```

```bash
# npm install
npm install gsap
```

```js
import { gsap } from "gsap";
```

## Basic Timeline

```js
const tl = gsap.timeline({ paused: true });

tl.to(".box", { x: 200, duration: 0.8, ease: "power2.out" })
  .to(".box", { opacity: 0, duration: 0.4 }, "+=0.2")
  .from(".title", { y: -50, autoAlpha: 0, duration: 0.6 }, "<");
```

**Position parameter shortcuts:**
- `"+=0.2"` — 0.2s after previous tween ends
- `"-=0.1"` — 0.1s before previous tween ends
- `"<"` — same start time as previous tween
- `"1.5"` — absolute 1.5s mark in timeline

## Playback Control API

```js
tl.play();             // play forward from current position
tl.pause();            // freeze
tl.resume();           // resume from paused position
tl.reverse();          // play backward from current position
tl.restart();          // jump to start and play
tl.seek(1.5);          // jump to 1.5s (no play)
tl.progress(0.5);      // jump to 50% of total duration
tl.timeScale(2);       // 2× speed
tl.timeScale(0.5);     // half speed

// Read state
tl.time();             // current time in seconds
tl.progress();         // 0–1
tl.duration();         // total duration
tl.isActive();         // true if currently playing
```

## Named Labels for Scene Control

```js
tl.addLabel("intro", 0)
  .addLabel("reveal", 1.5)
  .addLabel("outro", 3.0);

// Jump to scene
tl.seek("reveal");
tl.play("outro");
```

## API-Driven Control

See [rules/api-control.md](rules/api-control.md) for WebSocket, REST, and SSE control patterns.

## Effects & Presets

See [rules/effects.md](rules/effects.md) for reusable fade, slide, scale, and reveal effects.

## Sequencing & Staggering

See [rules/sequencing.md](rules/sequencing.md) for staggered lists, cascades, and orchestrated sequences.

## Text Animations

See [rules/text.md](rules/text.md) for character-by-character, word-by-word, and typewriter effects.

## Scroll-Driven Animations

See [rules/scroll.md](rules/scroll.md) for ScrollTrigger integration — scrub, pin, and enter/leave triggers.

## SVG Animations

See [rules/svg.md](rules/svg.md) for path drawing, morphing, and SVG-specific techniques.

## Integration Patterns

See [rules/integration.md](rules/integration.md) for embedding monomotion in dashboards, iframes, and web components.
