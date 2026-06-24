---
name: monodesign-optimize
description: Improve frontend performance — animation smoothness, bundle size, rendering, image optimization, and Core Web Vitals — without sacrificing design quality.
type: design-sub-command
argument-hint: "[target page or component]"
user-invocable: true
---

# Monodesign: Optimize

Improve frontend performance. Read `reference/optimize.md` from the monodesign skill directory for the full protocol.

## Performance Target: Core Web Vitals

- **LCP** (Largest Contentful Paint): ≤2.5s
- **INP** (Interaction to Next Paint): ≤200ms
- **CLS** (Cumulative Layout Shift): ≤0.1

## Common Design-Layer Performance Issues

**Animation performance**
- Animating layout properties (`width`, `height`, `padding`, `margin`, `top`, `left`) causes layout recalculation on every frame — replace with `transform` and `opacity` only
- Unbounded blur: `blur(20px)` on many elements is expensive — test and cap
- `will-change: transform` tells the browser to promote to its own layer — use sparingly (memory cost)
- Too many simultaneous animations — stagger rather than launch all at once

**Image optimization**
- `loading="lazy"` on all images below the fold
- `width` + `height` attributes on all images to prevent CLS
- Modern formats: WebP/AVIF > JPEG/PNG for photos
- `srcset` for responsive images
- CSS background images: consider whether an `<img>` with `loading="lazy"` would be faster

**Font loading**
- `font-display: swap` to prevent invisible text during font load
- Preload critical fonts: `<link rel="preload" as="font">`
- Subset fonts if using a custom typeface (Google Fonts does this automatically)

**CSS performance**
- Avoid `@import` in CSS (render-blocking)
- Don't use `:nth-child()` in hot paths with many elements
- CSS containment: `contain: layout style` on isolated components prevents unintended reflows

**JavaScript**
- Defer non-critical scripts: `<script defer>` or `<script type="module">`
- Code-split by route if using a framework
- Avoid inline event handlers at scale (use event delegation)

## Measurement

```bash
# Lighthouse in CLI
npx lighthouse <url> --output json --output html

# Web Vitals in DevTools
# Performance tab → Core Web Vitals section

# Bundle analysis (if Vite)
npx vite-bundle-analyzer
```

## Output

Specific optimizations with before/after measurements where measurable. Each change should cite the metric it improves.
