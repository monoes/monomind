---
name: monodesign-live
description: Iterate on the UI directly in the browser — screenshot, identify issues, apply targeted CSS fixes, verify, repeat — until the live result matches the design intent.
type: design-sub-command
argument-hint: "[target URL or component]"
user-invocable: true
---

# Monodesign: Live

Iterate on the UI directly in the browser. Read `reference/live.md` from the monodesign skill directory for the full protocol.

## CLAUDE.md Requirement

This command requires browser automation. Before proceeding, verify that `npx monomind browse` is available (`Skill("agent-browser-testing")`). If not, the `/monodesign live` flow falls back to editing CSS files and asking the user to refresh.

## Live Iteration Loop

The loop runs until the user confirms the design is right or cancels.

### 1. Screenshot
Capture the current state of the target URL or component. No assumptions — look at what's actually rendered.

### 2. Diagnose
Look at the screenshot with fresh eyes. Identify the top 3 issues:
- Visual hierarchy problems
- Spacing inconsistencies
- Color contrast issues
- Typography rendering
- Interaction state gaps
- Alignment problems

State the issues clearly before touching any code.

### 3. Apply targeted fix
Edit the CSS for the specific issue identified. Keep each fix surgical — change one thing at a time.

```css
/* Targeted fix: heading weight is too light — can't distinguish from body */
.hero-heading {
  font-weight: 800;
  font-size: clamp(2.5rem, 5vw, 4rem);
  letter-spacing: -0.03em;
}
```

### 4. Screenshot again
Verify the fix had the intended effect. Check for regressions on neighboring elements.

### 5. Confirm or continue
If the target issue is resolved, state what was fixed and move to the next. If the fix introduced a regression, roll back and try a different approach.

## Guidelines

- Fix the most visually impactful issue first
- Don't batch multiple fixes — screenshot after each change
- State what you're about to change and why before changing it
- If the same area has been fixed 3+ times without convergence, step back and assess whether the problem is structural (wrong layout approach) vs. cosmetic
- Deliver final CSS that can be committed, not just live browser overrides
