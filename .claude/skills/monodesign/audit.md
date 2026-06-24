---
name: monodesign-audit
description: Run systematic technical quality checks across accessibility, performance, theming, motion, and interaction — generate a scored report with specific findings. Documents issues; does not fix them.
type: design-sub-command
argument-hint: "[target file, route, or component]"
user-invocable: true
---

# Monodesign: Audit

Run systematic **technical** quality checks and generate a comprehensive scored report. This is a code-level audit, not a design critique. Check what's measurable and verifiable in the implementation. **Does not fix issues** — documents them for other commands to address.

Read `reference/audit.md` from the monodesign skill directory for the full scoring rubric.

## Diagnostic Scan — 5 Dimensions (score 0–4 each)

### 1. Accessibility (A11y)
- Contrast ratios (≥4.5:1 body, ≥3:1 large text)
- ARIA: interactive elements with proper roles, labels, states
- Keyboard navigation: focus indicators, logical tab order
- Semantic HTML: heading hierarchy, landmarks, divs vs. buttons
- Alt text quality; form labels; error messaging

### 2. Performance
- Layout thrashing (read/write layout properties in loops)
- Expensive animations (layout-property animation, unbounded blur/filter)
- Missing optimization (lazy loading, unoptimized assets, missing will-change)
- Bundle size: unnecessary imports, unused dependencies
- Unnecessary re-renders, missing memoization

### 3. Theming
- Hard-coded colors not using design tokens
- Broken dark mode: missing variants, poor contrast
- Inconsistent token usage; values that don't update on theme change

### 4. Motion
- Violations of `prefers-reduced-motion`
- Inappropriate motion: layout-property animation, bounce/elastic
- Reveal animations that gate content visibility (content ships blank if transition fails)
- Motion that adds no information (hover-scale on non-interactive elements)

### 5. Interaction
- Dropdown clipping (inside overflow:hidden — use popover API or position:fixed)
- Missing hover/focus/active/disabled states
- Form UX: validation feedback, error recovery, submission state

## Scoring

| Score | Meaning |
|---|---|
| 0 | Broken / inaccessible |
| 1 | Major gaps |
| 2 | Partial — effort exists, significant gaps remain |
| 3 | Good — mostly correct, minor improvements |
| 4 | Excellent |

## Output Format

```markdown
# Design Audit Report

**Target**: [file or route]
**Date**: [date]

## Scores
| Dimension | Score | Status |
|---|---|---|
| Accessibility | X/4 | [PASS/WARN/FAIL] |
| Performance | X/4 | ... |
| Theming | X/4 | ... |
| Motion | X/4 | ... |
| Interaction | X/4 | ... |
| **Total** | X/20 | |

## Findings by Priority

### Critical (fix before ship)
- [finding with file:line reference]

### High
- ...

### Medium
- ...

## Recommended next commands
- `/monodesign harden` — accessibility issues
- `/monodesign polish` — theming drift and interaction gaps
```
