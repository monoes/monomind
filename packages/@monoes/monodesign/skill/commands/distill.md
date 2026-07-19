---
name: monodesign-distill
description: Simplify an over-designed, cluttered, or complexity-burdened interface — remove what doesn't earn its place, reveal the essential structure underneath.
type: design-sub-command
argument-hint: "[target page, flow, or component]"
user-invocable: true
---

# Monodesign: Distill

Simplify an over-designed or cluttered interface. Read `reference/distill.md` from the monodesign skill directory for the full protocol.

## Philosophy

Every element on a page is a claim on the user's attention. When too many claims compete equally, the user's attention costs rise and comprehension falls. Distill removes the claims that can't justify their cost.

## Assess the Clutter

Walk through the interface and identify:

**Structural complexity**
- How many distinct visual layers exist? (More than 3 is usually too many)
- How many columns? (Sometimes 1 column is the right answer)
- Are there containers-within-containers? (Nested cards are always wrong)
- Is the Z-axis used purposefully or as a decoration?

**Information redundancy**
- Is the same information shown twice? (Heading + tooltip + label that all say the same thing)
- Are there labels that label things that are already obvious from context?
- Are there intros that restate the page title?

**Visual noise**
- Decorative dividers between every section when whitespace would suffice
- Icon + text where one alone would communicate equally well
- Background patterns, textures, or gradients that add nothing

**Navigation complexity**
- Are there paths that lead nowhere useful?
- Are there settings no one changes?
- Are there features that serve < 5% of users in the primary navigation?

## Distillation Protocol

1. **List every element** on the target surface (visual inventory)
2. **For each element, ask**: if this were removed, would a first-time user notice something missing? If no: remove it
3. **Consolidate redundant information** into one canonical location
4. **Increase whitespace** where elements were removed — don't fill the vacuum with something else
5. **Verify the essential path** still works and is faster than before

## Output

A version of the interface that is measurably simpler:
- Fewer distinct visual elements on screen at once
- Clearer visual hierarchy (the important thing is visually louder than the less-important thing)
- Faster to scan for a first-time user
- No functionality removed from the primary user path
