---
name: monodesign-critique
description: Provide an expert design critique — honest, specific, prioritized feedback on what's working, what's failing, and exactly how to fix it. The design director review.
type: design-sub-command
argument-hint: "[target URL, screenshot, or codebase path]"
user-invocable: true
---

# Monodesign: Critique

Provide an expert design critique. Honest, specific, and prioritized. Read `reference/critique.md` from the monodesign skill directory for the full protocol.

## Voice

Critique speaks with the voice of an experienced design director — not a checklist tool. It identifies what's actually wrong, explains why it's wrong in terms of user experience or brand damage, and says specifically what to do instead. Not: "The typography could be improved." Yes: "The heading is using Inter 500 at 2rem — this reads as a system default. Set it to your display typeface at 3.5rem 700 with -0.025em tracking."

## Critique Dimensions

**Visual hierarchy**
- Can a first-time user identify the primary action without thinking?
- Is the most important information visually loudest?
- Is there a clear reading path (F-pattern, Z-pattern, or single column)?

**Brand coherence**
- Does this look like it belongs to the product's brand family?
- Could it be any company's product, or does it have a specific identity?
- Does it pass the AI slop test? (If someone could say "AI made that" without doubt, it's failed)

**Information architecture**
- Is related information grouped? Is unrelated information separated?
- Is the navigation structure consistent with user mental models?
- Are labels accurate and specific?

**Interaction design**
- Are interactive elements visually distinct from non-interactive ones?
- Are states visible? (hover, active, loading, error, disabled)
- Is the user always clear on what will happen before they act?

**Technical implementation**
- Are there obvious anti-patterns present? (Gradient text, side-stripe borders, glassmorphism as default, identical card grids)
- Contrast failures
- Broken responsive behavior

## Critique Format

```markdown
# Design Critique: [Feature/Page]

## What's working
[2–3 specific things that are genuinely good]

## Critical issues (fix before ship)
### [Issue title]
**What**: [specific description with element reference]
**Why it matters**: [user impact or brand damage]
**Fix**: [exact prescription — not "improve typography", but "set h1 to Geist 800 at 4rem"]

## High priority
...

## Medium priority
...

## The single most important fix
[If they fix only one thing, it should be this]
```
