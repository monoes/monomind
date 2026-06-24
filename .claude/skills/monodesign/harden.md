---
name: monodesign-harden
description: Fix accessibility violations, keyboard navigation gaps, semantic HTML issues, ARIA problems, and contrast failures — bring the interface to WCAG AA compliance.
type: design-sub-command
argument-hint: "[target page or component]"
user-invocable: true
---

# Monodesign: Harden

Fix accessibility and robustness issues. Read `reference/harden.md` from the monodesign skill directory for the full protocol.

## Accessibility Targets

**WCAG AA** is the floor:
- Body text: ≥4.5:1 contrast ratio
- Large text (≥18px or bold ≥14px): ≥3:1
- Interactive element focus indicators: ≥3:1 against adjacent colors
- No information conveyed by color alone

**Keyboard navigation**
- Every interactive element reachable by Tab in logical order
- Visible focus ring on every focused element (never `outline: none` without a replacement)
- No keyboard traps
- Escape closes modals and dropdowns
- Arrow keys navigate within a group (menu items, radio buttons, tabs)

**Semantic HTML**
- Heading hierarchy is sequential (h1 → h2 → h3, no skipping)
- Landmark roles present (main, nav, aside, footer)
- Interactive elements use native elements (button, a, input) not div
- Forms have labels associated with inputs (via for/id or wrapping label)

**ARIA**
- Used only when native semantics can't convey the role
- `aria-label` on icon-only buttons
- `aria-expanded`, `aria-controls` on toggle buttons
- `aria-live` on dynamic content that updates without page reload
- `role="status"` or `role="alert"` on notification areas

**Images**
- Decorative images: `alt=""`
- Informative images: alt describes the information (not "image of...")
- Icon images: alt is the icon's semantic meaning

## Hardening Checklist

```
[ ] Run automated check: `npx axe <url>` or equivalent
[ ] Tab through entire page — every interactive element reachable
[ ] Check all headings form a logical hierarchy
[ ] Verify all contrast ratios pass
[ ] Test all interactive elements with keyboard only
[ ] Verify screen reader announces dynamic content
[ ] Check all forms have properly associated labels
[ ] Test at 200% zoom — nothing overlaps or disappears
[ ] Verify reduced motion preference is respected
```

## Never

- `outline: none` or `outline: 0` without a replacement focus indicator
- `tabindex="-1"` on focusable elements without a keyboard alternative
- Color as the only differentiator between states
- ARIA roles that contradict the HTML semantics (role="button" on an anchor that navigates)
