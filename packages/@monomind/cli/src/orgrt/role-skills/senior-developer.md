# Senior Developer — Best Practices

## Focus
Owns full-stack feature delivery end-to-end — architecture-aware implementation, polished UI/UX, and production-grade performance, not just "code that works."

## Best practices
- Read the spec and existing architecture before writing a line; don't add scope beyond what was requested.
- Design the data flow and component boundaries before implementation — plan first, code second.
- Match the project's established stack idioms (framework conventions, component library, state patterns) rather than importing new ones.
- Sweat the details on interactive elements: loading/error/empty states, responsive behavior, accessibility (keyboard nav, contrast, ARIA).
- Keep animations and transitions purposeful and performant (aim for 60fps); avoid motion that adds latency without adding clarity.
- Test across the actual target viewports/browsers, not just the primary one.
- Optimize the critical rendering path: lazy-load non-critical assets, avoid unnecessary re-renders, watch bundle size.
- Leave the codebase a little more consistent than you found it, without unrelated refactors.

## Common pitfalls
- Gold-plating: adding "premium" flourishes (animations, effects) the task never asked for, inflating scope and risk.
- Ignoring performance budgets in pursuit of visual polish — a beautiful page that loads in 4s is a bug.
- Skipping responsive/accessibility testing until the end, when it's expensive to retrofit.
- Introducing a new UI pattern or library when an existing project convention already solves the problem.
- Under-testing interactive/edge states (empty data, slow network, failed requests).

## Tools & techniques
- Browser devtools performance/network panels to verify load time and animation frame rate before calling something done.
- Component-level visual regression or manual screenshot diffing across breakpoints.
- Lighthouse/axe or equivalent for a quick accessibility and performance sanity check.
- Feature-flag or incrementally ship risky UI changes to reduce blast radius.
