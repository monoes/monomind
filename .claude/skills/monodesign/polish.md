---
name: monodesign-polish
description: Perform a meticulous final pass to catch all the small details that separate good work from great work — design system alignment, interaction states, spacing precision, copy consistency, edge cases.
type: design-sub-command
argument-hint: "[target component, page, or feature]"
user-invocable: true
---

# Monodesign: Polish

Perform a meticulous final pass. The difference between shipped and polished. Read `reference/polish.md` from the monodesign skill directory for the full protocol.

## Design System Discovery (required first step)

1. **Find the design system**: Look for documentation, component libraries, style guides, token definitions
2. **Note the conventions**: spacing scale, color tokens, motion patterns, component API
3. **Identify drift, then name the root cause**: classify each deviation as:
   - **Missing token** — value should exist in the system but doesn't
   - **One-off implementation** — shared component exists but wasn't used
   - **Conceptual misalignment** — flow, IA, or hierarchy doesn't match neighboring features

Polish **must** align the feature with the design system. If none exists, polish against visible codebase conventions.

## Pre-Polish Assessment

1. **Review completeness**: Is it functionally complete? Are there known issues to preserve (mark TODOs)?
2. **Think experience-first**: Walk the path from the user's perspective before opening DevTools
3. **Identify polish areas**:
   - Visual inconsistencies
   - Spacing and alignment issues
   - Interaction state gaps (hover, focus, active, disabled, loading)
   - Copy inconsistencies and redundancies
   - Edge cases and error states
   - Loading and transition smoothness
   - Information architecture drift

## Polish Checklist

**Visual**
- [ ] Consistent spacing using the design system scale
- [ ] Typography hierarchy visible at a glance (size + weight contrast)
- [ ] Color contrast meets WCAG AA minimums
- [ ] All interactive elements have hover + focus states
- [ ] Loading/skeleton states for async content
- [ ] Empty states designed (not blank)

**Copy**
- [ ] No restated headings or intros that repeat the title
- [ ] Error messages are actionable (not "Something went wrong")
- [ ] No em dashes — use commas, colons, or semicolons
- [ ] Consistent voice with PRODUCT.md

**Motion**
- [ ] Transitions feel intentional, not added by reflex
- [ ] All animations have `prefers-reduced-motion` fallback
- [ ] No layout-property animation

**Responsive**
- [ ] All text within viewport, no overflow at any breakpoint
- [ ] Touch targets ≥44×44px on mobile

## Browser Verification

Use browser automation to verify the live result — don't assume the CSS is correct. Check:
- The actual user path (not just the happy state)
- Mobile viewport
- Dark/light mode switch
- Keyboard navigation
