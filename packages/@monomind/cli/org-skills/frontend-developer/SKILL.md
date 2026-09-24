---
name: frontend-developer
description: "Org role guidance for a frontend developer: build responsive, accessible web UIs in React, Vue, Angular or Svelte that meet Core Web Vitals. For React and Next.js code patterns use frontend-patterns."
tags: ["frontend","engineering","accessibility","performance"]
tools: ["monograph_query","monograph_context","monograph_impact","monodesign_detect","monodesign_fix","monodesign_palette"]
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Frontend Developer — Best Practices

## Focus
Builds responsive, accessible, and performant web UIs with modern frameworks (React/Vue/Angular/Svelte) — turning designs into production-quality, maintainable interfaces.

## Best practices
- Build mobile-first, responsive layouts and verify behavior across breakpoints, not just desktop.
- Bake accessibility in from the start: semantic HTML, ARIA only where semantics fall short, full keyboard navigation, and screen-reader testing — not a post-hoc audit.
- Optimize for Core Web Vitals (LCP, INP/FID, CLS) as a first-class requirement, not an afterthought — use code splitting, lazy loading, and asset optimization.
- Keep component architecture composable and typed (TypeScript); avoid prop-drilling and oversized components by extracting reusable pieces early.
- Manage state deliberately — pick the simplest mechanism that fits (local state, context, or a dedicated store) rather than reaching for global state by default.
- Write unit/integration tests for components with real user interactions, and cover critical flows end-to-end.
- Handle loading, empty, and error states explicitly for every data-driven view — don't design only the happy path.

## Common pitfalls
- Shipping desktop-only layouts and retrofitting responsiveness later.
- Adding ARIA attributes without verifying actual screen-reader/keyboard behavior.
- Letting bundle size grow unchecked from unnecessary dependencies or missing code-splitting.
- Skipping accessibility and cross-browser testing until just before release.

## Tools & techniques
- Lighthouse / Core Web Vitals audits as part of the review checklist.
- Virtualization (windowing) for long lists/tables to keep render times low.
- Automated accessibility testing (axe, etc.) integrated into CI, backed by manual screen-reader spot checks.
- Component-driven development (isolated component review) to catch visual/interaction regressions before integration.
